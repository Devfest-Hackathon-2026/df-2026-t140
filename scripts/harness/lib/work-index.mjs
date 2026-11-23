// いま誰が何をしているかを集める。人が書いた要約ではなく、一次の記録から集める：
//   1. origin/main の docs/work/（main に入れた作業宣言）
//   2. 各リモートブランチの作業宣言と、実際に変えたファイル（git diff）
//   3. 開いている PR と、merge 済みの PR と、Issue（gh。使えなければ飛ばす）
//   4. 人の判断（todo/humans/）。人間待ちはここから決める（カンバンは Actions が映すだけ。lib/board.mjs）
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ledgerPathFor } from './conventions.mjs'
import { HUMAN_STATUS, HUMANS_DIR, parseHumanTodo } from './humans.mjs'
import { blockedBy } from './board.mjs'
import { parseLedger, STATUS } from './ledger.mjs'
import { globsOverlap, matchesAny } from './paths.mjs'
import { gh, git, gitOut, TIMEOUT_MS } from './proc.mjs'

// 複数の作業がよく同時に触る。重なったら、小さく早く merge する
export const SHARED_FILES = [
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'package.json',
  'package-lock.json',
  'web/package.json',
  'web/package-lock.json',
  'functions/package.json',
  'functions/package-lock.json',
  'web/src/app/**',
  'functions/src/index.ts',
  'functions/src/app/**',
  'docs/product/proposal.md',
  'CLAUDE.md',
]

export function fetchOrigin(cwd) {
  return git(['fetch', '--prune', '--quiet', 'origin'], { cwd, timeout: TIMEOUT_MS.network })
}

function listFiles(ref, dir, cwd) {
  const out = gitOut(['ls-tree', '-r', '--name-only', ref, '--', dir], { cwd })
  return out ? out.split('\n').filter(Boolean) : []
}

const show = (ref, path, cwd) => gitOut(['show', `${ref}:${path}`], { cwd })

/**
 * `git cat-file --batch` の出力（バイト列）を、問い合わせ（「ref:path」）ごとの中身に分ける。ないものは undefined。
 * 中身は git show と同じく前後の空白を落とす（gitOut と同じ形）。長さはバイトで数える（日本語の宣言があるため）
 */
export function parseCatFileBatch(output, specs) {
  const result = new Map()
  let at = 0
  for (const spec of specs) {
    const end = output.indexOf(0x0a, at)
    if (end < 0) break
    const header = output.subarray(at, end).toString('utf8')
    at = end + 1
    const match = header.match(/^\S+ (\S+) (\d+)$/)
    if (!match) {
      result.set(spec, undefined) // 「<spec> missing」など
      continue
    }
    const size = Number(match[2])
    result.set(spec, match[1] === 'blob' ? output.subarray(at, at + size).toString('utf8').trim() : undefined)
    at += size + 1 // 中身のあとの改行
  }
  return result
}

/**
 * 「ref:path」をまとめて読む（git を 1 回だけ呼ぶ）。ブランチが増えると、1 つずつ git show を呼ぶとセッションの始めのフックが
 * 30 秒を超えたため（2026-11-22。リモートのブランチ 251 本で、git を約 760 回呼んでいた）。読めなければ 1 つずつ読む
 */
function showMany(specs, cwd) {
  if (specs.length === 0) return new Map()
  const run = spawnSync('git', ['cat-file', '--batch'], { cwd, input: `${specs.join('\n')}\n`, maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS.local })
  const parsed = run.status === 0 && run.stdout ? parseCatFileBatch(run.stdout, specs) : new Map()
  // 出力が途中で切れたなどで答えのない問い合わせは、1 つずつ読む（黙って「ない」扱いにしない）
  for (const spec of specs) {
    if (!parsed.has(spec)) parsed.set(spec, show(spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1), cwd))
  }
  return parsed
}

const isLedgerFile = (path) => /^docs\/work\/[^/]+\.md$/.test(path) && !/\/(README|_template)\.md$/.test(path)

/** merge された作業は、宣言を「完了」に書き換え忘れていても完了とみなす（main より先の commit も、開いた PR もない） */
export const isMergedWork = (entry, mergedBranches) => mergedBranches.has(entry.branch) && entry.ahead === 0 && !entry.pr

/**
 * 作業が終わったか。merge 済みか中止なら終わり。「完了」でも PR が開いているあいだは、レビューを待っているだけなので
 * まだ作業中に数える（カンバンは merge まで In Progress のまま。docs/process/work.md「カンバン」）
 */
export function isFinishedWork(entry, mergedBranches) {
  const status = entry.ledger?.status
  if (status === STATUS.dropped || isMergedWork(entry, mergedBranches)) return true
  return status === STATUS.done && !entry.pr
}

/** merge 済みの PR の一覧から、作業が merge されたブランチを集める。作業宣言だけの PR（「作業宣言: …」）は数えない */
export const mergedWorkBranches = (prs) => new Set(prs.filter((pr) => !/^作業宣言[:：]/.test(pr.title ?? '')).map((pr) => pr.headRefName))

export function collectWork({ cwd, withPrs = true, timeout, runGh = gh } = {}) {
  const entries = new Map()
  const warnings = []

  if (gitOut(['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd }) === undefined) {
    warnings.push('origin/main が見つかりません。git fetch origin を試してください')
    return { entries: [], warnings, mergedKnown: false }
  }

  const mainPaths = listFiles('origin/main', 'docs/work', cwd).filter(isLedgerFile)
  const mainTexts = showMany(mainPaths.map((path) => `origin/main:${path}`), cwd)
  for (const path of mainPaths) {
    const text = mainTexts.get(`origin/main:${path}`)
    if (!text) continue
    const ledger = parseLedger(text, path)
    if (!ledger.branch) continue
    entries.set(ledger.branch, { branch: ledger.branch, ledger, source: 'main', remote: false, changed: [], ahead: 0 })
  }

  const refs = (gitOut(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], { cwd }) ?? '')
    .split('\n')
    .filter((ref) => ref && ref !== 'origin' && ref !== 'origin/HEAD' && ref !== 'origin/main')
  // main に入ったブランチ（main より先の commit がない）は、1 回で見分けて rev-list を飛ばす
  const merged = new Set(
    (gitOut(['branch', '-r', '--merged', 'origin/main', '--format=%(refname:short)'], { cwd }) ?? '').split('\n').filter(Boolean),
  )
  const branchTexts = showMany(refs.map((ref) => `${ref}:${ledgerPathFor(ref.replace(/^origin\//, ''))}`), cwd)
  for (const ref of refs) {
    const branch = ref.replace(/^origin\//, '')
    const ahead = merged.has(ref) ? 0 : Number(gitOut(['rev-list', '--count', `origin/main..${ref}`], { cwd }) ?? 0)
    const text = branchTexts.get(`${ref}:${ledgerPathFor(branch)}`)
    const ledger = text ? parseLedger(text, ledgerPathFor(branch)) : entries.get(branch)?.ledger
    if (ahead === 0 && !ledger) continue // merge 済みで宣言もないブランチ
    const changed =
      ahead > 0 ? (gitOut(['diff', '--name-only', `origin/main...${ref}`], { cwd }) ?? '').split('\n').filter(Boolean) : []
    entries.set(branch, { branch, ledger, source: text ? 'branch' : entries.get(branch)?.source ?? 'none', remote: true, changed, ahead })
  }

  let mergedBranches = new Set()
  let mergedKnown = false
  if (withPrs) {
    const merged = runGh(['pr', 'list', '--state', 'merged', '--limit', '300', '--json', 'title,headRefName'], { cwd, ...(timeout ? { timeout } : {}) })
    if (merged.ok) mergedBranches = mergedWorkBranches(JSON.parse(merged.stdout || '[]'))
    else warnings.push('merge 済みの PR の一覧を取れませんでした。merge 済みの作業が「進行中」に出ることがあります')
    mergedKnown = merged.ok
    const result = runGh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,headRefName,isDraft,labels,author,url'], { cwd, ...(timeout ? { timeout } : {}) })
    if (result.ok) {
      for (const pr of JSON.parse(result.stdout || '[]')) {
        const entry = entries.get(pr.headRefName) ?? { branch: pr.headRefName, remote: true, changed: [], ahead: 0, source: 'none' }
        entry.pr = pr
        entries.set(pr.headRefName, entry)
      }
    } else {
      warnings.push(result.missing ? 'gh がないので、PR は調べていません' : 'gh で PR を調べられませんでした（ネットワークかログイン）')
    }
  }

  const list = [...entries.values()].map((entry) => {
    const status = entry.ledger?.status
    const merged = isMergedWork(entry, mergedBranches)
    const finished = isFinishedWork(entry, mergedBranches)
    return {
      ...entry,
      title: entry.ledger?.title ?? entry.pr?.title ?? '',
      issue: entry.ledger?.issue,
      owner: entry.ledger?.owner ?? entry.pr?.author?.login ?? '',
      status: status ?? '宣言なし',
      scope: entry.ledger?.scope ?? [],
      active: !finished && (entry.remote || Boolean(entry.pr)),
      // main に「進行中」で残っているのに、ブランチも PR もない
      stale: status === STATUS.active && !entry.remote && !entry.pr && !merged,
    }
  })
  return { entries: list.filter((entry) => entry.active || entry.stale), warnings, mergedKnown }
}

// 開いている GitHub Issue を集め、進行中の作業ブランチと紐づける
export function collectOpenIssues(cwd, entries = []) {
  const result = gh(['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,labels,assignees,url'], { cwd })
  if (!result.ok) return { issues: [], ok: false }
  const byIssue = new Map()
  for (const entry of entries) {
    if (entry.issue && entry.active) byIssue.set(entry.issue, entry)
  }
  const issues = JSON.parse(result.stdout || '[]').map((issue) => {
    const active = byIssue.get(issue.number)
    const labels = (issue.labels ?? []).map((item) => item.name).filter(Boolean)
    return {
      number: issue.number,
      title: issue.title ?? '',
      labels,
      assignees: (issue.assignees ?? []).map((item) => item.login).filter(Boolean),
      url: issue.url ?? '',
      activeBranch: active?.branch,
      activeOwner: active?.owner,
    }
  })
  return { issues, ok: true }
}

// AI が着手できる Issue。進行中のもの、人を待っているもの（todo/humans/ の open な判断が指すもの）、
// 担当が付いているもの（人の判断が決まって、頼んだ人の作業に戻ったものなど）は除く
export function backlogIssues(issues, todos = []) {
  const blocked = blockedBy(todos)
  return issues.filter((item) => !item.activeBranch && !blocked.has(item.number) && (item.assignees ?? []).length === 0)
}

// 進行中の作業はないが、担当が付いている Issue（人の判断が決まって作業に戻ったものなど）。担当の人が拾う
export function heldIssuesByAssignee(issues, todos = []) {
  const blocked = blockedBy(todos)
  return issues.filter((item) => !item.activeBranch && !blocked.has(item.number) && (item.assignees ?? []).length > 0)
}

// me：{ branch, scope, changed }。ほかの作業と、触る範囲や実際の変更が重なるところ
export function findOverlaps(me, entries) {
  const overlaps = []
  for (const other of entries) {
    if (other.branch === me.branch || !other.active) continue
    const paths = new Set()
    for (const mine of me.scope) {
      for (const theirs of other.scope) if (globsOverlap(mine, theirs)) paths.add(theirs)
    }
    for (const file of other.changed) if (matchesAny(file, me.scope)) paths.add(file)
    for (const file of me.changed ?? []) if (matchesAny(file, other.scope)) paths.add(file)
    if (paths.size > 0) {
      const list = [...paths]
      overlaps.push({ other, paths: list, shared: list.some((path) => SHARED_FILES.some((shared) => globsOverlap(path, shared))) })
    }
  }
  return overlaps
}

export function collectHumanTodos(cwd, { ref } = {}) {
  const files = ref
    ? listFiles(ref, HUMANS_DIR, cwd)
    : (gitOut(['ls-files', '--cached', '--others', '--exclude-standard', '--', HUMANS_DIR], { cwd }) ?? '').split('\n')
  const todos = []
  for (const path of files.filter((file) => /\.md$/.test(file) && !/\/(README|_template)\.md$/.test(file))) {
    const text = ref ? show(ref, path, cwd) : readWorking(cwd, path)
    if (text) todos.push(parseHumanTodo(text, path))
  }
  return todos
}

export const openHumanTodos = (todos) => todos.filter((todo) => todo.status !== HUMAN_STATUS.done)

function readWorking(cwd, path) {
  try {
    return readFileSync(join(cwd ?? process.cwd(), path), 'utf8')
  } catch {
    return undefined
  }
}
