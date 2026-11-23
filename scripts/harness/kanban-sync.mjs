#!/usr/bin/env node
// カンバンと Issue を、一次の記録（todo/humans/、作業宣言、Issue と PR）に合わせる。GitHub Actions（.github/workflows/kanban.yml）が動かす。
//   node scripts/harness/kanban-sync.mjs [--dry-run]
// 何をどうするかは lib/board.mjs が決める。ここは GitHub から読み、決まったことを実行するだけ。
//   - 人間待ちの Issue・PR に「⏸ 人間待ち」のコメントを付け、決まったら「✅ 決まりました」に書き換える
//   - Discord の #人間待ち のカードを、人間待ち（赤）→ 対応中（黄）→ 完了（緑）と書き換える
//   - 人の判断が決まった Issue は、すぐ In Progress に移し、判断を頼んだ人を担当にする
//   - 人間待ちが残る Issue を閉じる PR の「Closes #N」を「Refs #N」にし、閉じてしまった Issue は開け直す
//   - 人の判断が済んだ Issue を閉じる（人の作業の Issue と、Refs で開けておいた Issue）
//   - 進行中の作業が結び付いた Issue に、作業する人を担当（assignee）として足す（名簿は members.json）
//   - カンバンの列（Todo / In Progress / 人間待ち / Done）をそろえる。KANBAN_TOKEN（project の権限）がないときは飛ばす
// Issue とコメントの操作は GH_TOKEN（Actions の標準のトークン）で、カンバンの操作だけ KANBAN_TOKEN で行う。
import { askedBranch, askerOf, blockedBy, CLOSED_MARKER, planAssignees, withRecentlyClosed, discordIdOf, doneOwnIssues, HELD_MARKER, boardItems, hasHeldMarker, reopenedByHuman, heldIssues, humanTargets, planBoard, planHumanComments, renderHumanComment, resumedBy, rewriteClosing } from './lib/board.mjs'
import { HUMAN_STATUS } from './lib/humans.mjs'
import { createKanban, parseBlockRefs } from './lib/kanban.mjs'
import { editDiscord, humanLink, mentionIds, postDiscord, renderHuman, webhookFor } from './lib/discord.mjs'
import { discordName, loadMembers } from './lib/members.mjs'
import { gh as runGh, repoRoot } from './lib/proc.mjs'
import { collectHumanTodos, collectWork } from './lib/work-index.mjs'

const root = repoRoot(process.cwd()) ?? process.cwd()
const dryRun = process.argv.includes('--dry-run')
const TIMEOUT = 30_000
const RECENT_DAYS = 14 // 決まった判断のコメントを書き換えに行く範囲（古いものは、止めていた Issue が開いているか最近閉じたときだけ見に行く）

const gh = (args, env) => runGh(args, { cwd: root, timeout: TIMEOUT, env })
const log = (line) => console.log(line)
const warnings = []

function json(args, env) {
  const result = gh(args, env)
  if (!result.ok) throw new Error(`gh ${args.slice(0, 3).join(' ')}：${(result.stderr || result.stdout).trim().split('\n')[0]}`)
  return JSON.parse(result.stdout || 'null')
}

/** 実行する（--dry-run なら表示だけ）。失敗は警告に積み、ほかの操作は続ける */
function act(label, args, env) {
  log(`${dryRun ? '（試し）' : ''}${label}`)
  if (dryRun) return
  const result = gh(args, env)
  if (!result.ok) warnings.push(`${label}：${(result.stderr || result.stdout).trim().split('\n')[0]}`)
}

const repo = process.env.GITHUB_REPOSITORY || json(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner
const fileUrl = (path) => `https://github.com/${repo}/blob/main/${path}`
const daysAgo = (date) => (Date.now() - new Date(`${date}T00:00:00+09:00`).getTime()) / 86_400_000

// ---- 読む ---------------------------------------------------------------------------

const allTodos = collectHumanTodos(root)
const blocked = blockedBy(allTodos)

const { entries, warnings: workWarnings, mergedKnown } = collectWork({ cwd: root, timeout: TIMEOUT })
warnings.push(...workWarnings)
const active = new Set(entries.filter((entry) => entry.active && entry.issue).map((entry) => Number(entry.issue)))

const openIssues = json(['issue', 'list', '--state', 'open', '--limit', '300', '--json', 'number,assignees'])
// 最近閉じた Issue。決まってから日がたった判断でも、止めていた Issue がまだ開いている・最近閉じたなら見に行く
// （Discord のカードを「対応中」から「完了」へ変え、開いているあいだは In Progress に置くため）
const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10)
const recentClosed = gh(['issue', 'list', '--state', 'closed', '--limit', '300', '--search', `closed:>=${since}`, '--json', 'number'])
if (!recentClosed.ok) warnings.push('最近閉じた Issue を読めなかったので、決まってから日がたった判断のカードは書き換えません')
const recentClosedNumbers = recentClosed.ok ? JSON.parse(recentClosed.stdout || '[]').map((issue) => issue.number) : []
const live = new Set([...openIssues.map((issue) => issue.number), ...recentClosedNumbers])
const todos = allTodos.filter(
  (todo) =>
    todo.status !== HUMAN_STATUS.done ||
    (todo.decidedAt && daysAgo(todo.decidedAt) <= RECENT_DAYS) ||
    parseBlockRefs(todo.blocks).some((number) => live.has(number)),
)
let issues = openIssues.map((issue) => ({ number: issue.number, state: 'OPEN', isPr: false }))
const known = new Set(issues.map((issue) => issue.number))
const targets = new Set(todos.flatMap(humanTargets))
const isPr = new Map()
const missing = new Set()
for (const number of targets) {
  // 打ち間違いなどで読めない番号は、その番号だけ飛ばす（同期の全体は止めない）
  try {
    const info = json(['api', `repos/${repo}/issues/${number}`, '--jq', '{state: .state, pr: (.pull_request != null)}'])
    isPr.set(number, info.pr)
    if (!known.has(number)) issues.push({ number, state: info.state === 'open' ? 'OPEN' : 'CLOSED', isPr: info.pr })
  } catch (error) {
    missing.add(number)
    warnings.push(`#${number} を読めないので飛ばします（todo/humans/ の blocks の番号を確かめます）：${error.message}`)
  }
}

// 最近閉じた Issue も対象にし、カンバンで Done でなければ Done にそろえる（閉じた直後の競合で In Progress に戻ったものを直す）
issues = withRecentlyClosed(issues, recentClosedNumbers)

const merged = new Set(
  json(['pr', 'list', '--state', 'merged', '--limit', '100', '--json', 'body']).flatMap((pr) => heldIssues(pr.body)),
)

let board
let items
if (process.env.KANBAN_TOKEN) {
  board = createKanban({ gh: (args) => gh(args, { GH_TOKEN: process.env.KANBAN_TOKEN }) })
  const listed = board.listItems()
  if (listed.ok) items = new Map(listed.items.filter((item) => item.number).map((item) => [item.number, item.status]))
  else warnings.push(`カンバンを読めませんでした：${listed.warning}`)
} else {
  log('KANBAN_TOKEN がないので、カンバンの列は動かしません（Issue のコメントと開け閉めだけ行います。todo/humans/2026-11-16-kanban-token.md）')
}

// ---- 決める・実行する ---------------------------------------------------------------

// 1. PR の「Closes #N」を、人間待ちが残る N だけ「Refs #N」に
for (const pr of json(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,body'])) {
  const body = rewriteClosing(pr.body, blocked)
  // gh pr edit は Projects の GraphQL も読み、標準のトークンでは権限が足りないことがあるので、REST で書き換える
  if (body) act(`PR #${pr.number}：人間待ちの Issue を閉じないよう Refs に書き換える`, ['api', '-X', 'PATCH', `repos/${repo}/pulls/${pr.number}`, '-f', `body=${body}`])
}

// 2. 人間待ちのコメント
// --paginate はページごとに出力するので、1 件を 1 行の JSON にして読む（コメントが 100 件を超えても壊れない）
// 人間待ちの対象に加え、閉じる候補（merge 済み、人の作業の Issue）の開いた Issue も読む（ハーネスが一度閉じたかを印で見るため）
const existing = new Map()
const closedOnce = new Set()
const openNumbers = new Set(issues.filter((issue) => issue.state === 'OPEN').map((issue) => issue.number))
const toRead = new Set([...targets, ...[...merged, ...doneOwnIssues(allTodos)].filter((n) => openNumbers.has(n))])
for (const number of [...toRead].filter((n) => !missing.has(n))) {
  try {
    const out = gh(['api', '--paginate', `repos/${repo}/issues/${number}/comments?per_page=100`, '--jq', '.[] | {id, body} | tojson'])
    if (!out.ok) throw new Error((out.stderr || out.stdout).trim().split('\n')[0])
    const list = out.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    existing.set(number, list)
    // 前に人間待ちのため開け直した Issue（Refs になる前に merge で閉じたもの）は、判断が済んだら閉じる
    if (hasHeldMarker(list)) merged.add(number)
    // ハーネスが一度閉じ、人が開け直した Issue は、もう閉じない（続きの作業のために開けたので）
    if (reopenedByHuman(list)) closedOnce.add(number)
  } catch (error) {
    missing.add(number)
    warnings.push(`#${number} のコメントを読めないので飛ばします：${error.message}`)
  }
}
const members = loadMembers(root)
// 人の判断が決まって作業に戻る Issue（最近決まったものだけ）。進行中の作業が見えなくても In Progress にし、頼んだ人を担当にする
const resumed = new Map([...resumedBy(todos)].filter(([number]) => openNumbers.has(number) && !missing.has(number)))

// Issue の開け閉めと列を先に決めておく（実行は 4. で行う）。この実行で閉じる Issue を、Discord のカードの「完了」に数えるため
// （ハーネスが閉じても、このワークフローはもう一度は動かない）
// merge 済みの一覧が取れなかった実行では、merge 済みの作業が進行中に見えるので、カンバンの列は動かさない
if (!mergedKnown && items) warnings.push('merge 済みの PR の一覧を取れなかったので、この実行ではカンバンの列を動かしません')
const plan = planBoard({ issues: issues.filter((issue) => !missing.has(issue.number)), todos: allTodos, active, merged, items: boardItems(items, mergedKnown), closedOnce, resumed })
const states = new Map(issues.filter((issue) => !missing.has(issue.number)).map((issue) => [issue.number, issue.state]))
for (const { number } of plan.close) states.set(number, 'CLOSED')
for (const { number } of plan.reopen) states.set(number, 'OPEN')

// Discord の #人間待ち：まだ送っていない open な人間待ちを送り、メッセージの番号を受け取る。
// 番号は Issue のコメントに印として覚えさせ、決まったら同じメッセージを「対応中」、止めていた Issue が閉じたら「完了」に書き換える（1 つの判断に 1 件）
const humanHook = webhookFor('human')
const repoUrl = `https://github.com/${repo}`
const askerName = (todo) => {
  const owner = askerOf(todo, entries, members)
  return owner ? discordName(owner, members) : undefined
}
// 人間待ちを知らせる相手：mention: に書いた人、なければ判断を頼んだ人（決まったあとのカードでは鳴らさない）
const humanText = (todo, phase) =>
  renderHuman(todo, {
    url: humanLink(todo, { repoUrl, targets: humanTargets(todo) }),
    phase,
    assignee: askerName(todo),
    mentions: mentionIds(todo, { asker: askerOf(todo, entries, members), members }),
  })
const discordIds = new Map()
for (const todo of todos.filter((item) => item.status !== HUMAN_STATUS.done)) {
  // コメントを付けられる番号がない判断は、番号を覚えておけないので送らない
  if (!humanTargets(todo).some((number) => !missing.has(number)) || discordIdOf(todo, existing)) continue
  log(`${dryRun ? '（試し）' : ''}#人間待ち に流す${humanHook ? '' : '（Webhook が未登録なので送りません）'}：${todo.title}`)
  if (dryRun || !humanHook) continue
  try {
    const id = await postDiscord(humanHook, humanText(todo), { wait: true })
    if (id) discordIds.set(todo.path, id)
  } catch (error) {
    warnings.push(`#人間待ち に送れませんでした：${error.message}`)
  }
}
const comments = planHumanComments({ todos, existing, fileUrl, skip: missing, discordIds, states })
// 決まった判断：前に送ったカードを、今の状態（対応中・完了）に書き換える（止めている番号が複数でも 1 回）。
// 番号を覚えていない古い人間待ちだけは、新しく送って番号を覚えさせる。Issue のコメントを書き換える前に行う
// （コメントが先だと、途中で止まったとき次の実行で状態が変わったと分からず、Discord が古い状態のまま残る）
const PHASE_LABEL = { working: '対応中', done: '完了' }
const changed = new Map()
for (const item of comments.update) if (item.discordChange) changed.set(item.todo.path, item)
// 書き換えに失敗した判断は、コメントも書き換えない（次の実行で、状態が変わったと分かって試し直せるように）
const failedEdits = new Set()
for (const { todo, discordId, phase } of changed.values()) {
  const label = PHASE_LABEL[phase] ?? phase
  log(`${dryRun ? '（試し）' : ''}#人間待ち の${discordId ? `カードを「${label}」に書き換える` : `「${label}」を送る`}${humanHook ? '' : '（Webhook が未登録なので送りません）'}：${todo.title}`)
  if (dryRun || !humanHook) continue
  try {
    if (discordId) await editDiscord(humanHook, discordId, humanText(todo, phase))
    else {
      const id = await postDiscord(humanHook, humanText(todo, phase), { wait: true })
      // 送ったカードの番号をコメントに覚えさせ、次からは同じカードを書き換える
      if (id) for (const item of comments.update.filter((entry) => entry.todo.path === todo.path)) item.body = renderHumanComment(todo, fileUrl(todo.path), { discordId: id, phase })
    }
  } catch (error) {
    failedEdits.add(todo.path)
    warnings.push(`#人間待ち を更新できませんでした（次の実行で試し直します）：${error.message}`)
  }
}

// PR にも付けられるよう、Issue のコメントの API を直接使う（gh issue comment は PR の番号を受け付けない）
for (const { number, body } of comments.create) act(`#${number}：人間待ちのコメントを付ける`, ['api', `repos/${repo}/issues/${number}/comments`, '-f', `body=${body}`])
for (const { number, id, body, todo, discordChange } of comments.update) {
  if (discordChange && failedEdits.has(todo.path)) continue
  act(`#${number}：人間待ちのコメントを書き換える`, ['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${id}`, '-f', `body=${body}`])
}

// 3. 担当：進行中の作業が結び付いた Issue に、作業する人を足す（外さない）
// 担当にできるのはリポジトリの collaborator だけ。--jq の出力は 1 行 1 件
const assignableOut = gh(['api', '--paginate', `repos/${repo}/assignees?per_page=100`, '--jq', '.[].login'])
const assignable = assignableOut.ok ? new Set(assignableOut.stdout.split('\n').filter(Boolean).map((login) => login.toLowerCase())) : undefined
if (!assignableOut.ok) warnings.push('担当にできるアカウントの一覧を読めなかったので、名簿のアカウントをそのまま担当にします')
// 人の判断が決まって作業に戻る Issue には、判断を頼んだ人を担当として足す（ほかの人が拾わないように）
const resumedEntries = [...resumed]
  .filter(([number]) => !active.has(number) && !plan.close.some((item) => item.number === number))
  .map(([number, todo]) => ({ active: true, issue: number, owner: askerOf(todo, entries, members), branch: askedBranch(todo) || todo.path }))
  .filter((entry) => entry.owner)
const assignees = planAssignees({
  entries: [...entries, ...resumedEntries],
  issues: openIssues.map((issue) => ({ number: issue.number, assignees: (issue.assignees ?? []).map((item) => item.login) })),
  members,
  assignable,
})
for (const { number, login, branch } of assignees) {
  act(`#${number}：${login} を担当にする（${branch}）`, ['api', `repos/${repo}/issues/${number}/assignees`, '-f', `assignees[]=${login}`])
}

// 4. Issue の開け閉めと、カンバンの列（決めたのは上の plan）
for (const { number, todos: waitingFor } of plan.reopen) {
  const list = waitingFor.map((todo) => `- ${todo.title}（${todo.path}）`).join('\n')
  const why = `${HELD_MARKER}人の判断・作業がまだ残っているので開け直しました。終わっていれば、決めた内容を AI に伝えるか \`npm run human -- done\` で記録してください（記録すると閉じます）。\n\n${list}`
  act(`#${number}：人間待ちが残っているので開け直す`, ['issue', 'reopen', String(number), '--comment', why])
}
for (const { number, reason, todo } of plan.close) {
  const why =
    reason === 'human-done'
      ? `${CLOSED_MARKER}人の判断が記録されたので閉じます：${todo.decision}（${[todo.decidedBy, todo.decidedAt].filter(Boolean).join('、')}）\n\n${todo.path}`
      : `${CLOSED_MARKER}人の判断・作業が済み、merge 済みの PR のほかに残りの作業がないので閉じます。続きがあれば開け直してください（開け直したら、ハーネスはもう閉じません）`
  act(`#${number}：閉じる（${reason === 'human-done' ? '人の判断が済んだ' : '人間待ちが済み、作業は merge 済み'}）`, ['issue', 'close', String(number), '--comment', why])
}
if (board) {
  for (const { number, column } of plan.moves) {
    log(`${dryRun ? '（試し）' : ''}#${number}：カンバンを「${column}」に`)
    if (dryRun) continue
    const moved = board.moveToColumn(number, column)
    if (!moved.ok) warnings.push(`#${number} を「${column}」にできませんでした：${moved.warning}`)
  }
}

const counts = [
  `コメント 新規 ${comments.create.length}・更新 ${comments.update.length}`,
  `開け直し ${plan.reopen.length}`,
  `閉じる ${plan.close.length}`,
  `担当 ${assignees.length}`,
  board ? `カンバンの移動 ${plan.moves.length}` : 'カンバンは飛ばした',
]
log(`\nまとめ：${counts.join('、')}`)
for (const warning of warnings) log(`注意：${warning}`)
