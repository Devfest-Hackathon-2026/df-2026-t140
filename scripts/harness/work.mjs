#!/usr/bin/env node
// 作業の始めから終わりまで。手順の説明は docs/process/work.md。
//   npm run work -- status                     ほかの人と AI の作業、未着手 Issue、重なり、人の判断待ち
//   npm run work -- sync                       main の最新を今のブランチへ取り込む（作業の始めに。フックのある AI は自動）
//   npm run work -- issue --title "…" […]      開発タスクを GitHub Issue に起票する（カンバンの Todo に載る）
//   npm run work -- start <種類>/<内容> [--issue <番号>] [--title "…"] [--carry]
//                                               ブランチと作業宣言の下書きを作る（Issue があれば引き継ぐ）
//   npm run work -- declare [--no-merge]        Issue がなければ自動起票し、宣言を main に入れ、作業用の PR（作業中ラベル）を作る
//   npm run work -- adopt [--issue <番号>]      作業宣言のないブランチに、今の変更から宣言を作る
//   npm run work -- finish                      完了条件と結果を確かめ、PR と Issue をレビュー待ちにする
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { formatResults, hasFailure, runChecks, treeSource } from './lib/checks.mjs'
import { BRANCH_TYPES, checkBranchName, isProtectedBranch, isWipPr, ledgerPathFor, WIP_LABEL } from './lib/conventions.mjs'
import { parseSections, setFrontMatterValue } from './lib/frontmatter.mjs'
import { parseIssueNumber, parseLedger, renderLedgerTemplate, STATUS, validateLedger } from './lib/ledger.mjs'
import { currentBranch, gh, git, gitOut, repoRoot, TIMEOUT_MS } from './lib/proc.mjs'
import { describeSync, syncWithMain } from './lib/sync-main.mjs'
import { blockedBy, closingKeyword, humanTargets, rewriteClosing } from './lib/board.mjs'
import { backlogIssues, collectHumanTodos, collectOpenIssues, collectWork, fetchOrigin, findOverlaps, openHumanTodos } from './lib/work-index.mjs'

// push は pre-push のフック（ハーネスのチェック）と通信を待つので、手元の操作の上限（10 秒）では足りないことがある。publish-humans と同じ長さにする
const PUSH_TIMEOUT_MS = TIMEOUT_MS.network * 10

const root = repoRoot(process.cwd()) ?? process.cwd()
const [command, ...rest] = process.argv.slice(2)

const VALUE_OPTIONS = new Set(['title', 'issue', 'kind', 'goal', 'todo', 'done', 'scope', 'body'])

function option(name) {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}
const flag = (name) => rest.includes(`--${name}`)

function positionalArgs() {
  const out = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg.startsWith('--')) {
      if (VALUE_OPTIONS.has(arg.slice(2))) i++
      continue
    }
    out.push(arg)
  }
  return out
}

function die(message, hints = []) {
  console.error(`\n[work] ${message}`)
  for (const hint of hints) console.error(`  - ${hint}`)
  process.exit(1)
}

function must(result, message) {
  if (!result.ok) die(message, [(result.stderr || result.stdout).trim()].filter(Boolean))
  return result.stdout.trim()
}

const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10) // JST
const owner = () => gitOut(['config', 'user.name'], { cwd: root }) ?? ''
const agentName = () =>
  process.env.HARNESS_AGENT ?? (process.env.CLAUDECODE ? 'Claude Code' : process.env.CODEX_HOME ? 'Codex' : process.env.ANTIGRAVITY_CLI_ALIAS ? 'Antigravity' : '')

function readLedger(branch) {
  const path = ledgerPathFor(branch)
  const full = join(root, path)
  if (!existsSync(full)) return undefined
  return parseLedger(readFileSync(full, 'utf8'), path)
}

// ---- GitHub Issue ------------------------------------------------------------------
// 状態（Todo / In Progress / 人間待ち / Done）はラベルでなくカンバンで表す。カンバンは GitHub Actions が
// 一次の記録から動かす（lib/board.mjs、kanban-sync.mjs）。ここで付けるラベルは種類（feat、fix …）だけ

function ensureLabel(name, color = 'ededed', description = '') {
  if (!name) return
  gh(['label', 'create', name, '--color', color, '--description', description, '--force'], { cwd: root })
}

function parseListLines(text) {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*(\[( |x|X)\]\s*)?/, '').replace(/^`|`$/g, '').trim())
    .filter(Boolean)
}

function fetchIssueDetails(issueNumber) {
  const res = gh(['issue', 'view', String(issueNumber), '--json', 'number,title,body,state,url'], { cwd: root })
  if (!res.ok) return undefined
  const data = JSON.parse(res.stdout)
  const body = data.body ?? ''
  const sections = parseSections(body)
  const scopeSection = sections['触る範囲（scope）'] ?? sections['scope'] ?? ''
  const scope = parseListLines(scopeSection)
  const doneCriteria = parseListLines(sections['完了条件'] ?? '')
  const goal = sections['目的'] || (!Object.keys(sections).length ? body.trim() : '')
  const todo = sections['やること'] ?? ''
  return {
    number: data.number,
    title: String(data.title ?? '').replace(/^\[\w+\]\s*/, '').trim(),
    url: data.url ?? '',
    state: data.state ?? 'OPEN',
    goal,
    todo,
    doneCriteria,
    scope,
  }
}

function renderIssueBody({ goal = '', todo = '', doneCriteria = [], scope = [], branch, ledgerPath }) {
  const doneLines = doneCriteria.length > 0 ? doneCriteria.map((item) => `- [ ] ${String(item).replace(/^\s*-\s*\[[ xX]\]\s*/, '')}`).join('\n') : '- [ ] 完了条件を満たすこと'
  const scopeLines = scope.length > 0 ? scope.map((item) => `- \`${item}\``).join('\n') : '- （作業宣言で指定）'
  const footer = branch && ledgerPath ? `\n---\n作業ブランチ：\`${branch}\`／作業宣言：\`${ledgerPath}\`\n` : ''
  return `## 目的

${goal.trim() || '（目的を記入）'}

## やること

${todo.trim() || '（やることを記入）'}

## 完了条件

${doneLines}

## 触る範囲（scope）

${scopeLines}
${footer}`
}

function createIssueFromLedger(ledger, branch) {
  const kind = branch.split('/')[0]
  if (kind) ensureLabel(kind, 'c5def5', `種類：${kind}`)
  const labels = kind ?? ''
  const body = renderIssueBody({
    goal: ledger.sections['目的'] ?? '',
    todo: ledger.sections['やること'] ?? '',
    doneCriteria: ledger.doneCriteria.map((item) => item.label),
    scope: ledger.scope,
    branch,
    ledgerPath: ledger.path,
  })
  const res = gh(['issue', 'create', '--title', ledger.title, '--body', body, ...(labels ? ['--label', labels] : [])], { cwd: root })
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout).trim() }
  const url = res.stdout.trim().split('\n').pop()?.trim() ?? ''
  const number = parseIssueNumber(url)
  return { ok: Boolean(number), number, url }
}

// ---- issue ------------------------------------------------------------------------

function issue() {
  const title = option('title') ?? positionalArgs()[0]
  if (!title) {
    die('Issue のタイトルを指定します', [
      '例：npm run work -- issue --title "旅の作成画面（S01）" --kind feat --goal "S01 で旅を作れるようにする" --done "2 つ目のブラウザで同じ旅に入れる" --scope "web/src/features/create-trip/**"',
    ])
  }
  const kind = option('kind')
  if (kind && !BRANCH_TYPES.includes(kind)) {
    die(`--kind は ${BRANCH_TYPES.join('、')} のどれかにします（今は「${kind}」）`)
  }
  const rawBody = option('body') ?? ''
  const goal = option('goal') ?? rawBody
  const todo = option('todo') ?? ''
  const doneCriteria = (option('done') ?? '')
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const scope = (option('scope') ?? '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

  if (kind) ensureLabel(kind, 'c5def5', `種類：${kind}`)
  const body = renderIssueBody({ goal, todo, doneCriteria, scope })
  const url = must(gh(['issue', 'create', '--title', title, '--body', body, ...(kind ? ['--label', kind] : [])], { cwd: root }), 'GitHub Issue を作れませんでした')
  const number = parseIssueNumber(url)
  console.log(`\nGitHub Issue ${number ? `#${number} ` : ''}を起票しました：${url}`)
  console.log(`着手するとき：npm run work -- start ${kind ?? '<種類>'}/<内容>${number ? ` --issue ${number}` : ''}`)
}

// ---- status -----------------------------------------------------------------------

function status() {
  const fetched = fetchOrigin(root)
  if (!fetched.ok) console.log('（origin を取得できませんでした。手元の情報で表示します）')
  const { entries, warnings } = collectWork({ cwd: root })
  const { issues, ok: issuesOk } = collectOpenIssues(root, entries)
  const branch = currentBranch(root)
  if (flag('json')) {
    console.log(JSON.stringify({ branch, entries, issues, warnings }, null, 2))
    return
  }
  console.log(`\nいまのブランチ：${branch || '（なし）'}\n`)
  console.log(`進行中の作業（${entries.length} 件）`)
  for (const entry of entries) {
    const issueText = entry.issue ? `Issue #${entry.issue} / ` : ''
    const pr = entry.pr ? `PR #${entry.pr.number}${isWipPr(entry.pr) ? ` ${WIP_LABEL}` : ''}` : 'PR なし'
    console.log(`- ${entry.branch}  ${entry.owner || '不明'} / ${issueText}${pr} / ${entry.stale ? '止まっている？（ブランチも PR もない）' : entry.status}`)
    if (entry.title) console.log(`    ${entry.title}`)
    if (entry.scope.length) console.log(`    範囲：${entry.scope.join(', ')}`)
    if (entry.changed.length) console.log(`    変更済み：${entry.changed.slice(0, 8).join(', ')}${entry.changed.length > 8 ? ' …' : ''}`)
  }
  if (issuesOk) {
    const backlog = backlogIssues(issues, openHumanTodos(collectHumanTodos(root)))
    console.log(`\n未着手の Issue（${backlog.length} 件）`)
    if (backlog.length === 0) {
      console.log('- なし（起票は `npm run work -- issue --title "…"`）')
    } else {
      for (const item of backlog) console.log(`- #${item.number} ${item.title}`)
      console.log('  着手するとき：`npm run work -- start <種類>/<内容> --issue <番号>`')
    }
  }
  const mine = readLedger(branch)
  if (mine) {
    const changed = (gitOut(['diff', '--name-only', 'origin/main...HEAD'], { cwd: root }) ?? '').split('\n').filter(Boolean)
    const overlaps = findOverlaps({ branch, scope: mine.scope, changed }, entries)
    console.log(`\n自分の作業（${mine.title}）と重なるところ：${overlaps.length ? '' : 'なし'}`)
    for (const overlap of overlaps) {
      console.log(`- ${overlap.other.branch}：${overlap.paths.join(', ')}${overlap.shared ? '（共有ファイル。先に小さく merge するか、担当を分ける）' : ''}`)
    }
  }
  const todos = openHumanTodos(collectHumanTodos(root))
  console.log(`\n人の判断待ち（todo/humans/）：${todos.length ? '' : 'なし'}`)
  for (const todo of todos) {
    const targets = humanTargets(todo).map((number) => `#${number}`).join(' ')
    console.log(`- ${todo.title}（${todo.kind}、${todo.path}${targets ? `、止めている：${targets}` : ''}）`)
  }
  for (const warning of warnings) console.log(`\n注意：${warning}`)
}

// ---- start ------------------------------------------------------------------------

function start() {
  const branch = positionalArgs()[0]
  const name = checkBranchName(branch ?? '')
  if (!name.ok) die(name.reason, ['例：npm run work -- start feat/trip-create --issue 12 --title "旅の作成画面（S01）"'])

  const rawIssue = option('issue')
  const issueNum = parseIssueNumber(rawIssue)
  if (rawIssue !== undefined && Number.isNaN(issueNum)) {
    die(`--issue は Issue 番号（例：12 または #12）で指定します（今は「${rawIssue}」）`)
  }
  const issueInfo = issueNum ? fetchIssueDetails(issueNum) : undefined
  if (issueNum && !issueInfo) {
    console.log(`（Issue #${issueNum} の詳細を gh で取得できませんでした。番号だけ作業宣言に記録します）`)
  }

  const title = option('title') ?? issueInfo?.title ?? branch.split('/')[1]

  fetchOrigin(root)
  if (gitOut(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root })) die(`ブランチ ${branch} はもうあります`, [`続きなら git switch ${branch}`])
  if (gitOut(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: root })) {
    die(`ほかの人がもう ${branch} を使っています`, ['`npm run work -- status` で確かめ、別の名前にします'])
  }

  const now = currentBranch(root)
  const dirty = (gitOut(['status', '--porcelain'], { cwd: root }) ?? '').split('\n').filter(Boolean)
  const notes = []

  if (isProtectedBranch(now) || !now) {
    const ahead = Number(gitOut(['rev-list', '--count', 'origin/main..HEAD'], { cwd: root }) ?? 0)
    if (ahead > 0) {
      // main で commit してしまった変更を、新しいブランチへ運ぶ
      must(git(['switch', '-c', branch], { cwd: root }), 'ブランチを作れませんでした')
      if (now) must(git(['branch', '-f', now, 'origin/main'], { cwd: root }), `${now} を origin/main に戻せませんでした`)
      notes.push(`${now || 'HEAD'} にあった push していない commit ${ahead} 個を ${branch} へ移し、${now || 'main'} は origin/main に戻しました`)
    } else {
      const fromOrigin = git(['switch', '-c', branch, 'origin/main'], { cwd: root })
      if (!fromOrigin.ok) {
        // 未 commit の変更と origin/main の差がぶつかるときは、今の位置から作る
        must(git(['switch', '-c', branch], { cwd: root }), 'ブランチを作れませんでした')
        notes.push('未 commit の変更があるので、今の位置からブランチを作りました。commit したあと `git merge origin/main` で最新にします')
      }
    }
    if (dirty.length > 0) notes.push(`未 commit の変更 ${dirty.length} ファイルを、消さずにそのまま ${branch} へ移しました（人の作業かもしれません。宣言の scope に含めるか確かめます）`)
  } else {
    if (dirty.length > 0 && !flag('carry')) {
      die(`いまのブランチ ${now} に未 commit の変更があります`, [`${now} の作業なら、先に commit して push します`, '新しい作業に持っていくなら --carry を付けます'])
    }
    const base = flag('carry') ? [] : ['origin/main']
    must(git(['switch', '-c', branch, ...base], { cwd: root }), 'ブランチを作れませんでした')
    if (flag('carry')) notes.push(`${now} の未 commit の変更を ${branch} へ移しました`)
  }

  const path = ledgerPathFor(branch)
  const changed = dirty.map((line) => line.slice(3).replace(/^.* -> /, ''))
  const initialScope = [...new Set([...changed, ...(issueInfo?.scope ?? [])].filter(Boolean))]
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(
    join(root, path),
    renderLedgerTemplate({
      branch,
      title,
      issue: issueNum,
      owner: owner(),
      agent: agentName(),
      started: today(),
      scope: initialScope,
      goal: issueInfo?.goal ?? '',
      todo: issueInfo?.todo ?? '',
      doneCriteria: issueInfo?.doneCriteria ?? [],
    }),
  )

  if (issueNum) notes.push(`GitHub Issue #${issueNum}（${issueInfo?.title ?? title}）と紐づけました（declare で宣言を main に入れると、カンバンは In Progress になります）`)

  console.log(`\n作業ブランチ ${branch} を作り、作業宣言の下書き ${path} を置きました。`)
  for (const note of notes) console.log(`- ${note}`)
  console.log('\n次にすること：')
  console.log(`1. ${path} の目的、scope（触るファイル）、完了条件、正本への影響を書く`)
  console.log('2. `npm run work -- status` で重なる作業を確かめ、「他の作業との調整」に書く')
  console.log('3. `npm run work -- declare` で宣言を main に入れ、Issue（未指定なら自動起票）と作業用の PR（作業中ラベル）を作る')
}

// ---- declare ----------------------------------------------------------------------

function declare() {
  const branch = currentBranch(root)
  if (isProtectedBranch(branch) || !branch) die('作業ブランチの上で実行します', ['先に `npm run work -- start <種類>/<内容>`'])
  let ledger = readLedger(branch)
  if (!ledger) die(`${ledgerPathFor(branch)} がありません`, ['`npm run work -- start` か `npm run work -- adopt` で作ります'])
  const errors = validateLedger(ledger, { phase: 'declare', branch })
  if (errors.length > 0) die('作業宣言に足りないところがあります', errors)

  fetchOrigin(root)
  const { entries } = collectWork({ cwd: root })
  const overlaps = findOverlaps({ branch, scope: ledger.scope, changed: [] }, entries)
  if (overlaps.length > 0) {
    console.log('\nほかの作業と重なるところがあります：')
    for (const overlap of overlaps) console.log(`- ${overlap.other.branch}（${overlap.other.owner}）：${overlap.paths.join(', ')}${overlap.shared ? '（共有ファイル）' : ''}`)
    if (!ledger.sections['他の作業との調整']) {
      die('重なりがあるので、作業宣言の「## 他の作業との調整」に、どう分けるかを書いてから宣言します')
    }
  }

  const path = ledger.path
  const fullPath = join(root, path)
  if (!ledger.issue) {
    const created = createIssueFromLedger(ledger, branch)
    if (created.ok) {
      const updated = setFrontMatterValue(readFileSync(fullPath, 'utf8'), 'issue', created.number)
      writeFileSync(fullPath, updated)
      ledger = parseLedger(updated, path)
      console.log(`\nGitHub Issue #${created.number} を自動起票しました：${created.url}`)
    } else {
      console.log(`\n（GitHub Issue を自動起票できませんでした：${created.error || 'gh が使えません'}）`)
    }
  }

  must(git(['add', '--', path], { cwd: root }), '作業宣言を add できませんでした')
  const staged = gitOut(['diff', '--cached', '--name-only', '--', path], { cwd: root })
  if (staged) must(git(['commit', '-m', `docs: ${ledger.title} の作業を宣言する`, '--', path], { cwd: root }), '作業宣言を commit できませんでした（git hooks の表示を見て直します）')
  must(git(['push', '-u', 'origin', branch], { cwd: root, timeout: PUSH_TIMEOUT_MS }), 'push できませんでした')

  const onlyDeclaration = (gitOut(['diff', '--name-only', `origin/main...origin/${branch}`], { cwd: root }) ?? '')
    .split('\n')
    .filter(Boolean)
    .every((file) => file.startsWith('docs/work/'))
  const issueRef = ledger.issue ? `関連 Issue：#${ledger.issue}\n\n` : ''
  const body = `作業宣言です。詳しくは \`${path}\`。\n\n${issueRef}${ledger.sections['目的'] ?? ''}\n\nこの PR は docs/work/ だけを変えるので、ハーネスが main に入れます（デプロイと CI の重い確認は走りません）。`
  const existing = gh(['pr', 'view', branch, '--json', 'number,url,state'], { cwd: root })
  const open = existing.ok && JSON.parse(existing.stdout).state === 'OPEN'

  if (flag('no-merge') || !onlyDeclaration) {
    if (!open) {
      const url = createWorkPr(branch, ledger, 'PR を作れませんでした')
      console.log(`\n作業用の PR（${WIP_LABEL}）：${url}`)
    }
    if (!onlyDeclaration) console.log('ブランチに宣言以外の変更もあるので、宣言だけを main に入れることはせず、作業用の PR にまとめました')
    return
  }

  const declarationPr = open
    ? JSON.parse(existing.stdout).url
    : must(gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', `作業宣言: ${ledger.title}`, '--body', body], { cwd: root }), '宣言の PR を作れませんでした')
  const merged = gh(['pr', 'merge', declarationPr, '--merge', '--subject', `docs: ${ledger.title} の作業を宣言する（${branch}）`], { cwd: root })
  if (!merged.ok) {
    console.log(`\n宣言の PR を main に入れられませんでした。人に merge を頼みます：${declarationPr}`)
    console.log((merged.stderr || merged.stdout).trim())
    return
  }
  console.log(`\n作業宣言を main に入れました：${declarationPr}`)

  must(git(['commit', '--allow-empty', '-m', `chore: ${ledger.title} を始める`], { cwd: root }), '作業開始の commit を作れませんでした')
  must(git(['push', 'origin', branch], { cwd: root, timeout: PUSH_TIMEOUT_MS }), 'push できませんでした')
  const url = createWorkPr(branch, ledger, '作業用の PR を作れませんでした')
  console.log(`作業用の PR（${WIP_LABEL}）：${url}`)
  console.log('\nこのあと：区切りごとに commit して push。終わったら `npm run work -- finish`')
}

const prTitle = (branch, ledger) => `${branch.split('/')[0]}: ${ledger.title}`

// 作業用の PR は、ドラフトでなく「作業中」ラベルで作る（Free の Organization の private リポジトリでは Draft PR が使えない。
// lib/conventions.mjs の WIP_LABEL）。ラベルは --force で作り直すので、あってもなくても通る。
// 作れなかったとき（権限など）は、PR の作成が止まったときに原因が分かるよう理由を出す
function createWorkPr(branch, ledger, failure) {
  const label = gh(['label', 'create', WIP_LABEL, '--force', '--color', 'FBCA04', '--description', 'npm run work -- finish の前。merge しない'], { cwd: root })
  if (!label.ok) console.log(`「${WIP_LABEL}」ラベルを作れませんでした：${(label.stderr || label.stdout || '').trim()}`)
  return must(gh(['pr', 'create', '--base', 'main', '--head', branch, '--label', WIP_LABEL, '--title', prTitle(branch, ledger), '--body', workPrBody(ledger)], { cwd: root }), failure)
}

/** PR に書く Issue との結び付け。人間待ちが残る Issue は、merge で閉じないよう Refs にする（lib/board.mjs） */
function closingLine(issue) {
  const blocked = blockedBy(collectHumanTodos(root, { ref: 'origin/main' }))
  const plain = `Closes #${issue}`
  return closingKeyword(issue, blocked) === 'Refs' ? rewriteClosing(plain, blocked).trim() : plain
}

function workPrBody(ledger) {
  const criteria = ledger.doneCriteria.map((item) => `- [ ] ${item.label}`).join('\n')
  const closesLine = ledger.issue ? `\n${closingLine(ledger.issue)}\n` : ''
  return `作業宣言：\`${ledger.path}\`${closesLine}
## 目的

${ledger.sections['目的'] ?? ''}

## 完了条件（レビューはこれで測る）

${criteria}

## レビューする人へ

- 評価軸は docs/process/review-rubric.md。機械で見る項目は CI の「harness」に出ます
- 設計方針から外れたところは、ファイル内の \`@harness-exception\` に理由があります
`
}

// ---- adopt ------------------------------------------------------------------------

function adopt() {
  const branch = currentBranch(root)
  if (isProtectedBranch(branch) || !branch) die('作業ブランチの上で実行します')
  const name = checkBranchName(branch)
  if (!name.ok) die(`ブランチ名が決まりに合いません：${name.reason}`, ['`git branch -m <種類>/<内容>` で名前を変えてから実行します'])
  const path = ledgerPathFor(branch)
  if (existsSync(join(root, path))) die(`${path} はもうあります`)
  const rawIssue = option('issue')
  const issueNum = parseIssueNumber(rawIssue)
  if (rawIssue !== undefined && Number.isNaN(issueNum)) {
    die(`--issue は Issue 番号（例：12 または #12）で指定します（今は「${rawIssue}」）`)
  }
  const issueInfo = issueNum ? fetchIssueDetails(issueNum) : undefined
  fetchOrigin(root)
  const committed = (gitOut(['diff', '--name-only', 'origin/main...HEAD'], { cwd: root }) ?? '').split('\n')
  const dirty = (gitOut(['status', '--porcelain'], { cwd: root }) ?? '').split('\n').map((line) => line.slice(3).replace(/^.* -> /, ''))
  const scope = [...new Set([...committed, ...dirty, ...(issueInfo?.scope ?? [])].filter(Boolean))]
  const pr = gh(['pr', 'view', branch, '--json', 'title'], { cwd: root })
  const title = option('title') ?? issueInfo?.title ?? (pr.ok ? JSON.parse(pr.stdout).title.replace(/^\w+: /, '') : branch.split('/')[1])
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(
    join(root, path),
    renderLedgerTemplate({
      branch,
      title,
      issue: issueNum,
      owner: owner(),
      agent: agentName(),
      started: today(),
      scope,
      goal: issueInfo?.goal ?? '',
      todo: issueInfo?.todo ?? '',
      doneCriteria: issueInfo?.doneCriteria ?? [],
    }),
  )
  console.log(`${path} を、今の変更（${scope.length} ファイル）から作りました。目的と完了条件を書いて \`npm run work -- declare\` します`)
}

// ---- finish -----------------------------------------------------------------------

function finish() {
  const branch = currentBranch(root)
  const ledger = readLedger(branch)
  if (!ledger) die(`${ledgerPathFor(branch)} がありません`)
  const errors = validateLedger(ledger, { phase: 'finish', branch })
  if (errors.length > 0) die('作業宣言を完了の形にします', errors)
  if ((gitOut(['status', '--porcelain'], { cwd: root }) ?? '').trim()) die('commit していない変更があります', ['commit して push してから実行します'])

  fetchOrigin(root)
  const results = runChecks({ source: treeSource(root), cwd: root, branch, base: 'origin/main' })
  console.log(formatResults(results))
  if (hasFailure(results)) die('チェックに通りません。NG を直します')
  must(git(['push', 'origin', branch], { cwd: root, timeout: PUSH_TIMEOUT_MS }), 'push できませんでした')
  // CI と同じ確認を手元で走らせ、通った記録を PR に残す（CI が始まらないときは、この記録が merge の条件になる。verify-local.mjs）。
  // 通らなければ、レビュー待ちにしない
  const verified = spawnSync(process.execPath, [join(root, 'scripts', 'harness', 'verify-local.mjs')], { cwd: root, stdio: 'inherit' })
  if (verified.status !== 0) die('手元の確認（npm run verify:local）に通りません。直してから、もう一度 finish します')
  // 「作業中」ラベルを外す。前からあるドラフトの PR は ready にする（どちらか片方だけでも、レビュー待ちになる）
  const unlabeled = gh(['pr', 'edit', branch, '--remove-label', WIP_LABEL], { cwd: root })
  const state = gh(['pr', 'view', branch, '--json', 'isDraft'], { cwd: root })
  const draft = state.ok && JSON.parse(state.stdout).isDraft
  const ready = draft ? gh(['pr', 'ready', branch], { cwd: root }) : unlabeled
  const view = gh(['pr', 'view', branch, '--json', 'number,url,body'], { cwd: root })
  const pr = view.ok ? JSON.parse(view.stdout) : undefined
  let line
  if (ledger.issue && pr) {
    line = closingLine(ledger.issue)
    const blocked = blockedBy(collectHumanTodos(root, { ref: 'origin/main' }))
    const linked = new RegExp(`\\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs)\\s+#${ledger.issue}\\b`, 'i').test(pr.body ?? '')
    const body = linked ? rewriteClosing(pr.body, blocked) : `${pr.body ?? ''}\n\n${line}\n`.trim()
    if (body) gh(['pr', 'edit', String(pr.number), '--body', body], { cwd: root })
  }
  console.log(`\nPR をレビュー待ちにしました${ready.ok ? '' : '（すでにレビュー待ちか、gh が使えません）'}：${pr?.url ?? ''}`)
  if (line?.startsWith('Refs')) console.log(`GitHub Issue #${ledger.issue} は人の判断を待っているので、PR には Refs と書きました（merge しても閉じず、カンバンの「人間待ち」に残ります）`)
  else if (line) console.log(`PR が merge されると GitHub Issue #${ledger.issue} は閉じます`)
  console.log(`レビューは別のコンテキストで行います。Claude Code なら /review-pr ${pr?.number ?? '<番号>'}、ほかの AI は docs/process/reviewer.md`)
  const todos = openHumanTodos(collectHumanTodos(root))
  if (todos.length > 0) console.log(`人の判断待ちが ${todos.length} 件あります（todo/humans/）。関わるものは PR に書きます`)
}

// ---- sync -------------------------------------------------------------------------

function sync() {
  if (!fetchOrigin(root).ok) die('origin を取得できませんでした。ネットワークを確かめて、もう一度実行します')
  const result = syncWithMain(root)
  console.log(describeSync(result, currentBranch(root)) ?? 'main の最新はもう取り込んであります')
  if (!['up-to-date', 'fast-forwarded', 'merged', 'detached', 'no-base'].includes(result.state)) process.exit(1)
}

const commands = { status, sync, issue, start, declare, adopt, finish }
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(command ? 1 : 0)
}
commands[command]()
