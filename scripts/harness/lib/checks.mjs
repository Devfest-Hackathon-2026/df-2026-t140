// 機械で確かめること（決まった処理）。pre-push、CI、レビューパックが同じものを使う。
// LLM の判断で見ることは docs/process/review-rubric.md にあり、ここでは扱わない。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { checkArchitecture, isCodeFile } from './arch.mjs'
import { checkBranchName, isDeployBranch, isProtectedBranch, ledgerPathFor } from './conventions.mjs'
import { HUMANS_DIR, parseHumanTodo, validateHumanTodo } from './humans.mjs'
import { parseLedger, STATUS, validateLedger } from './ledger.mjs'
import { matchesAny, toPosix } from './paths.mjs'
import { OTHER_AI_PACKAGES } from './policy.mjs'
import { gitOut } from './proc.mjs'
import { forbiddenFileReason, scanAddedLines } from './secrets.mjs'

// lib や dist は名前だけで外さない（web/src/shared/lib は FSD のセグメント）。調べるフォルダを絞って速さを保つ
const SKIP_DIRS = new Set(['node_modules', '.git', '.harness', '.firebase'])
// AI が作る隔離用の worktree（別のブランチの作業ツリー）。中の文書はそのブランチで検査される
const SKIP_PATHS = new Set(['.claude/worktrees'])

// 作業ツリーを読む
export function treeSource(root) {
  const walk = (dir, out) => {
    let names = []
    try {
      names = readdirSync(join(root, dir))
    } catch {
      return out
    }
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue
      const path = dir ? `${dir}/${name}` : name
      if (SKIP_PATHS.has(path)) continue
      let stat
      try {
        stat = statSync(join(root, path))
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(path, out)
      else out.push(path)
    }
    return out
  }
  return {
    label: '作業ツリー',
    list: (dirs) => dirs.flatMap((dir) => walk(dir, [])),
    read: (path) => {
      try {
        return readFileSync(join(root, path), 'utf8')
      } catch {
        return undefined
      }
    },
    exists: (path) => existsSync(join(root, path)),
  }
}

// git の ref（例：origin/feat/x）を、チェックアウトせずに読む
export function refSource(ref, cwd) {
  return {
    label: ref,
    list: (dirs) => (gitOut(['ls-tree', '-r', '--name-only', ref, '--', ...dirs], { cwd }) ?? '').split('\n').filter(Boolean),
    read: (path) => gitOut(['show', `${ref}:${path}`], { cwd }),
    exists: (path) => ['blob', 'tree'].includes(gitOut(['cat-file', '-t', `${ref}:${path}`], { cwd }) ?? ''),
  }
}

const LINE_BUDGET = { 'CLAUDE.md': 150, 'AGENTS.md': 60, 'GEMINI.md': 60 }

const DOC_ROOTS = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'docs', 'todo', '.claude', '.gemini', '.codex', '.agents']
const DOC_SKIP = /^docs\/(ui\/screen-flow|architecture\/sources|contexts\/meetings)\/|\/node_modules\//
const PLAN_DOCS = /^(docs\/work|todo\/humans)\//
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const CODE_REF = /`((?:docs|todo|scripts|web|functions|evals|\.claude|\.githooks|\.github|\.gemini|\.codex|\.agents)\/[^`\s]*)`/g

function checkDocLinks(source) {
  const files = source.list(DOC_ROOTS).filter((path) => /\.md$/.test(path) && !DOC_SKIP.test(path))
  const missing = []
  for (const path of files) {
    const text = source.read(path) ?? ''
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    let ignoring = false
    lines.forEach((line, index) => {
      if (line.includes('<!-- links:ignore-start -->')) ignoring = true
      if (line.includes('<!-- links:ignore-end -->')) ignoring = false
      if (ignoring) return
      // コードの中（`...`）は書き方の例なので、リンクとしては数えない
      for (const match of line.replace(/`[^`]*`/g, '').matchAll(LINK)) {
        const target = match[1].split('#')[0].split('?')[0]
        if (!target || /^[a-z]+:/i.test(target)) continue
        const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(path), decodeURI(target)))
        if (!source.exists(resolved.replace(/\/$/, ''))) missing.push(`${path}:${index + 1} のリンク先 ${target} がありません`)
      }
      if (PLAN_DOCS.test(path)) return // 予定のファイルを書くので、存在は問わない
      for (const match of line.matchAll(CODE_REF)) {
        const ref = match[1].replace(/[:#].*$/, '').replace(/[,、。）)]+$/, '')
        if (/[*<>{}…$]/.test(ref)) continue
        // ファイル（最後に拡張子）かフォルダ（最後が /）の形だけを見る。docs/screen-flow のようなブランチ名は見ない
        const last = ref.replace(/\/$/, '').split('/').pop()
        if (!ref.endsWith('/') && !last.includes('.')) continue
        if (forbiddenFileReason(ref)) continue // .env や .local/ は、わざとリポジトリにないもの
        // リポジトリの直下からのパスか、文書のフォルダ・skill のフォルダからのパス（skill の中の scripts/ など）
        const skillRoot = path.match(/^(\.(?:claude|agents)\/skills\/[^/]+)\//)?.[1]
        const candidates = [ref, posix.join(posix.dirname(path), ref), skillRoot && posix.join(skillRoot, ref)].filter(Boolean)
        if (!candidates.some((candidate) => source.exists(candidate.replace(/\/$/, '')))) missing.push(`${path}:${index + 1} の \`${ref}\` がありません`)
      }
    })
  }
  return missing
}

function dependencyNames(text) {
  try {
    const json = JSON.parse(text)
    return Object.keys({ ...json.dependencies, ...json.devDependencies, ...json.optionalDependencies, ...json.peerDependencies })
  } catch {
    return []
  }
}

// 返り値：[{ id, title, status: ok | fail | warn | info | skip, details: [] }]
export function runChecks({ source, cwd, branch, base, head = 'HEAD', quick = false }) {
  const results = []
  const push = (id, title, status, details = []) => results.push({ id, title, status, details })

  // 1. 層のチェック
  const codeFiles = source
    .list(['web/src', 'functions/src'])
    .filter(isCodeFile)
    .map((path) => ({ path, text: source.read(path) ?? '' }))
  const arch = checkArchitecture(codeFiles)
  push(
    'arch',
    `設計方針の層（${arch.checked} ファイル）`,
    arch.violations.length || arch.errors.length ? 'fail' : arch.warnings.length ? 'warn' : 'ok',
    [
      ...arch.violations.map((item) => `${item.path}:${item.line} [${item.rule}] ${item.message}`),
      ...arch.errors.map((item) => `${item.path}:${item.line} ${item.message}`),
      ...arch.warnings.map((item) => `${item.path}:${item.line} ${item.message}`),
    ],
  )
  if (arch.exceptions.length > 0) {
    push('exceptions', `例外（@harness-exception）${arch.exceptions.length} 件`, 'info', arch.exceptions.map((item) => `${item.path}:${item.line} [${item.rule}] ${item.reason ?? '（理由なし）'}`))
  }

  // 2. 他社 AI の SDK
  const banned = []
  for (const manifest of ['package.json', 'web/package.json', 'functions/package.json']) {
    for (const name of dependencyNames(source.read(manifest) ?? '{}')) {
      if (OTHER_AI_PACKAGES.test(name)) banned.push(`${manifest}：${name}`)
    }
  }
  push('deps', 'プロダクトに他社 AI の SDK がない', banned.length ? 'fail' : 'ok', banned)

  // 3. エージェント向けの文書の長さ（膨らんだら分ける）
  const long = Object.entries(LINE_BUDGET)
    .map(([path, limit]) => ({ path, limit, lines: (source.read(path) ?? '').split('\n').length }))
    .filter((item) => item.lines > item.limit)
    .map((item) => `${item.path} が ${item.lines} 行（上限 ${item.limit}）。詳しい内容は docs/ へ分け、ここには道案内だけ残します`)
  push('budget', 'CLAUDE.md・AGENTS.md・GEMINI.md の長さ', long.length ? 'fail' : 'ok', long)

  // 4. 文書のリンクと、書かれたパスが実在するか（道案内が壊れていないか）
  const missing = checkDocLinks(source)
  push('links', '文書のリンクとパス', missing.length ? 'fail' : 'ok', missing)

  // 5. 人の判断（todo/humans/）
  const humanErrors = []
  const humanWarnings = []
  for (const path of source.list([HUMANS_DIR]).filter((file) => /\.md$/.test(file) && !/\/(README|_template)\.md$/.test(file))) {
    const result = validateHumanTodo(parseHumanTodo(source.read(path) ?? '', path))
    humanErrors.push(...result.errors)
    humanWarnings.push(...result.warnings)
  }
  push('humans', '人の判断（todo/humans/）の書き方', humanErrors.length ? 'fail' : humanWarnings.length ? 'warn' : 'ok', [...humanErrors, ...humanWarnings])

  // 6. 作業宣言の書き方
  const ledgerErrors = []
  for (const path of source.list(['docs/work']).filter((file) => /^docs\/work\/[^/]+\.md$/.test(file) && !/\/(README|_template)\.md$/.test(file))) {
    const ledger = parseLedger(source.read(path) ?? '', path)
    const phase = ledger.status === STATUS.active ? 'declare' : 'finish'
    ledgerErrors.push(...validateLedger(ledger, { phase }))
  }
  push('ledgers', '作業宣言（docs/work/）の書き方', ledgerErrors.length ? 'fail' : 'ok', ledgerErrors)

  // 共通の skill（.agents/skills：Codex、Gemini CLI、Antigravity が読む）は、Claude Code 用の写しと同じ中身にする
  const normalize = (text) => (text ?? '').replace(/\r\n/g, '\n')
  const drift = source
    .list(['.agents/skills'])
    .filter((path) => path.endsWith('/SKILL.md'))
    .filter((path) => normalize(source.read(path)) !== normalize(source.read(path.replace(/^\.agents\//, '.claude/'))))
    .map((path) => `${path} と ${path.replace(/^\.agents\//, '.claude/')} の中身が違います。片方を直したら、もう片方へ写します`)
  push('skills', '共通の skill と Claude Code 用の写し', drift.length ? 'fail' : 'ok', drift)

  if (quick) return results

  // 7. ブランチ名と、そのブランチの作業宣言（deploy は本番へ出すブランチで、作業ブランチではない）
  if (branch && !isProtectedBranch(branch) && !isDeployBranch(branch)) {
    const name = checkBranchName(branch)
    push('branch', `ブランチ名（${branch}）`, name.ok ? 'ok' : 'fail', name.ok ? [] : [name.reason])
    const ledgerPath = ledgerPathFor(branch)
    const text = source.read(ledgerPath)
    if (!text) {
      push('ledger', '作業宣言がある', 'fail', [`${ledgerPath} がありません。\`npm run work -- adopt\` で、今の変更から作れます`])
    } else {
      const ledger = parseLedger(text, ledgerPath)
      const errors = validateLedger(ledger, { phase: ledger.status === STATUS.active ? 'declare' : 'finish', branch })
      const issueWarn =
        !errors.length && ledger.hasIssueField && !ledger.issue && ledger.status === STATUS.active
          ? [`${ledgerPath}：issue（GitHub Issue 番号）がまだ空です。\`npm run work -- declare\` で自動起票するか、\`npm run work -- issue\` で起票して番号を書きます`]
          : []
      push(
        'ledger',
        `作業宣言（${ledger.status}${ledger.issue ? `、Issue #${ledger.issue}` : ''}）`,
        errors.length ? 'fail' : issueWarn.length ? 'warn' : 'ok',
        [...errors, ...issueWarn],
      )

      // 8. 宣言した範囲の外の変更
      if (base) {
        const changed = (gitOut(['diff', '--name-only', `${base}...${head}`], { cwd }) ?? '').split('\n').filter(Boolean)
        const allowed = [...ledger.scope, ledgerPath, 'docs/records/ai-usage.md', 'docs/architecture/decisions.md', `${HUMANS_DIR}/**`]
        const outside = changed.filter((file) => !matchesAny(file, allowed))
        push('scope', `宣言した範囲（変更 ${changed.length} ファイル）`, outside.length ? 'warn' : 'ok', outside.map((file) => `${file} は scope の外です。必要な変更なら作業宣言の scope に足します`))
      }
    }
  }

  if (base) {
    // 9. 秘密情報
    const diff = gitOut(['diff', '-U0', '--no-color', `${base}...${head}`], { cwd }) ?? ''
    const findings = scanAddedLines(diff).map((item) => `${item.file}:${item.line} ${item.label}（${item.excerpt}）`)
    const names = (gitOut(['diff', '--name-only', '--diff-filter=AM', `${base}...${head}`], { cwd }) ?? '').split('\n').filter(Boolean)
    const files = names.map((file) => ({ file, reason: forbiddenFileReason(file) })).filter((item) => item.reason).map((item) => `${item.file}：${item.reason}`)
    push('secrets', '秘密情報と、置いてはいけないファイル', findings.length || files.length ? 'fail' : 'ok', [...findings, ...files])

    // 10. 依存を足したら出典とライセンスを記録する（著作物利用シートの元）
    const manifests = names.filter((file) => /(^|\/)package\.json$/.test(file))
    const depsChanged = manifests.some((file) => {
      const before = new Set(dependencyNames(gitOut(['show', `${base}:${file}`], { cwd }) ?? '{}'))
      return dependencyNames(source.read(file) ?? '{}').some((name) => !before.has(name))
    })
    if (depsChanged && !names.includes('docs/records/credits.md')) {
      push('credits', '足した依存の出典とライセンス', 'warn', ['package.json に依存を足しました。docs/records/credits.md に名前、ライセンス、出典を足します'])
    }
  }
  return results
}

export function formatResults(results) {
  const mark = { ok: 'OK  ', fail: 'NG  ', warn: '注意', info: '情報', skip: '--  ' }
  const lines = []
  for (const result of results) {
    lines.push(`${mark[result.status]} ${result.title}`)
    for (const detail of result.details.slice(0, 40)) lines.push(`      ${detail}`)
    if (result.details.length > 40) lines.push(`      …ほか ${result.details.length - 40} 件`)
  }
  return lines.join('\n')
}

export const hasFailure = (results) => results.some((result) => result.status === 'fail')

export const toRepoPath = (root, file) => toPosix(file).replace(`${toPosix(root)}/`, '')
