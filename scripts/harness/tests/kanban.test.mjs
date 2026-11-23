// カンバン（GitHub Projects）との連動。gh は偽物を注入し、本物は叩かない。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isProdCheckBundle, parseHumanTodo, renderHumanTemplate, validateProdCheckBundles } from '../lib/humans.mjs'
import {
  blockedBy,
  closingKeyword,
  commentMarker,
  askedBranch,
  askerOf,
  discordIdFrom,
  discordPhaseFrom,
  humanPhase,
  resumedBy,
  discordIdOf,
  discordMarker,
  CLOSED_MARKER,
  HELD_MARKER,
  boardItems,
  withRecentlyClosed,
  hasClosedMarker,
  reopenedByHuman,
  hasHeldMarker,
  heldIssues,
  humanTargets,
  planBoard,
  planHumanComments,
  renderHumanComment,
  rewriteClosing,
} from '../lib/board.mjs'
import { classifyGhFailure, createKanban, findStatusOption, parseBlockRefs, parseIssueRef, parseProjectItems, SCOPE_HINT } from '../lib/kanban.mjs'
import { backlogIssues, collectWork, heldIssuesByAssignee, isFinishedWork, isMergedWork, mergedWorkBranches } from '../lib/work-index.mjs'

const FIELDS = {
  fields: [
    { id: 'F_TITLE', name: 'Title', type: 'ProjectV2Field' },
    {
      id: 'F_STATUS',
      name: 'Status',
      type: 'ProjectV2SingleSelectField',
      options: [
        { id: 'o_todo', name: 'Todo' },
        { id: 'o_prog', name: 'In Progress' },
        { id: 'o_wait', name: '人間待ち' },
        { id: 'o_done', name: 'Done' },
      ],
    },
  ],
}

/** gh の偽物。呼ばれた引数を記録し、コマンドに応じた答えを返す */
function fakeGh({ fail } = {}) {
  const calls = []
  let nextIssue = 200
  const gh = (args) => {
    calls.push(args)
    if (fail) return fail(args) ?? { ok: true, stdout: '' }
    const [a, b] = args
    if (a === 'project' && b === 'view') return { ok: true, stdout: JSON.stringify({ id: 'PVT_1' }) }
    if (a === 'project' && b === 'field-list') return { ok: true, stdout: JSON.stringify(FIELDS) }
    if (a === 'repo') return { ok: true, stdout: JSON.stringify({ nameWithOwner: 'o/r', url: 'https://github.com/o/r' }) }
    if (a === 'api') return { ok: true, stdout: `https://github.com/o/r/issues/${b.split('/').pop()}\n` }
    if (a === 'project' && b === 'item-add') return { ok: true, stdout: JSON.stringify({ id: `ITEM_${args[args.indexOf('--url') + 1].split('/').pop()}` }) }
    if (a === 'issue' && b === 'create') return { ok: true, stdout: `https://github.com/o/r/issues/${nextIssue++}\n` }
    if (a === 'project' && b === 'item-list') {
      return {
        ok: true,
        stdout: JSON.stringify({
          items: [
            { id: 'I1', title: 'A', status: '人間待ち', content: { number: 5, type: 'Issue', url: 'u5' } },
            { id: 'I2', title: 'B', status: 'Todo', content: { number: 6, type: 'Issue', url: 'u6' } },
          ],
        }),
      }
    }
    return { ok: true, stdout: '' }
  }
  return { gh, calls }
}

const edits = (calls) =>
  calls.filter((args) => args[1] === 'item-edit').map((args) => [args[args.indexOf('--id') + 1], args[args.indexOf('--single-select-option-id') + 1]])

const todo = (over = {}) => ({ path: 'todo/humans/2026-11-07-x.md', title: 'X を決める', kind: '権限', blocks: '', issue: '', status: 'open', ...over })

test('blocks から #番号だけを取り出す（重なりは 1 つ、URL の断片や & は数えない）', () => {
  assert.deepEqual(parseBlockRefs('#12 と #34、もう一度 #12'), [12, 34])
  assert.deepEqual(parseBlockRefs('PR #58 の merge'), [58])
  assert.deepEqual(parseBlockRefs('本番へのデプロイ（deploy ブランチへの反映）'), [])
  assert.deepEqual(parseBlockRefs('a/b#3 &#39; x#4'), [])
  assert.deepEqual(parseBlockRefs(undefined), [])
  assert.equal(parseIssueRef('#12'), 12)
  assert.equal(parseIssueRef('12'), 12)
  assert.equal(parseIssueRef(''), undefined)
})

test('Status の選択肢を名前で引き当てる', () => {
  assert.deepEqual(findStatusOption(FIELDS, '人間待ち'), { ok: true, fieldId: 'F_STATUS', optionId: 'o_wait' })
  assert.deepEqual(findStatusOption(FIELDS.fields, 'In Progress'), { ok: true, fieldId: 'F_STATUS', optionId: 'o_prog' })
  const missing = findStatusOption(FIELDS, 'Review')
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /人間待ち/)
  assert.equal(findStatusOption({ fields: [] }, '人間待ち').ok, false)
})

test('gh の失敗を分類し、権限不足なら gh auth refresh を案内する', () => {
  assert.equal(classifyGhFailure({ missing: true }).kind, 'missing')
  assert.equal(classifyGhFailure({ timedOut: true }).kind, 'offline')
  assert.equal(classifyGhFailure({ stderr: 'error connecting to api.github.com\ndial tcp: lookup api.github.com: no such host' }).kind, 'offline')
  const scope = classifyGhFailure({ stderr: "your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project" })
  assert.equal(scope.kind, 'scope')
  assert.ok(scope.message.includes(SCOPE_HINT))
  assert.equal(classifyGhFailure({ stderr: 'To get started with GitHub CLI, please run:  gh auth login' }).kind, 'auth')
  assert.equal(classifyGhFailure({ stderr: 'something odd' }).kind, 'other')
})

test('Project の一覧から列ごとに取り出す', () => {
  const items = parseProjectItems({ items: [{ id: 'I', title: 'T', status: '人間待ち', content: { number: 3, type: 'Issue', url: 'u' } }, { id: 'D', title: 'draft' }] })
  assert.deepEqual(items[0], { id: 'I', number: 3, type: 'Issue', url: 'u', title: 'T', status: '人間待ち' })
  assert.equal(items[1].number, undefined)
})

// ---- カンバンの操作（kanban.mjs） ----

test('Issue を指定の列に動かす。Project とフィールドは 1 回だけ読む', () => {
  const { gh, calls } = fakeGh()
  const board = createKanban({ gh })
  assert.deepEqual(board.moveToColumn(12, '人間待ち'), { ok: true, number: 12, column: '人間待ち' })
  assert.equal(board.moveToColumn(13, 'Todo').ok, true)
  assert.deepEqual(edits(calls), [['ITEM_12', 'o_wait'], ['ITEM_13', 'o_todo']])
  assert.equal(calls.filter((args) => args[1] === 'field-list').length, 1)
  assert.equal(board.moveToColumn(14, 'In Review').ok, false)
})

test('人の作業の Issue は、ラベルを付けずに起票する（状態はカンバンだけで表す）', () => {
  const { gh, calls } = fakeGh()
  const created = createKanban({ gh }).createHumanIssue({ title: 'X を決める', kind: '権限', path: 'todo/humans/2026-11-07-x.md' })
  assert.equal(created.number, 200)
  const create = calls.find((args) => args[0] === 'issue' && args[1] === 'create')
  assert.ok(!create.includes('--label'))
  assert.match(create[create.indexOf('--body') + 1], /https:\/\/github\.com\/o\/r\/blob\/main\/todo\/humans\/2026-11-07-x\.md/)
  assert.ok(!calls.some((args) => args[0] === 'label'))
})

test('project の権限がないとき：警告に gh auth refresh を出し、2 回目からは gh を呼ばない', () => {
  const scope = { ok: false, stderr: 'your authentication token is missing required scopes [project]' }
  const { gh, calls } = fakeGh({ fail: (args) => (args[0] === 'project' ? scope : undefined) })
  const board = createKanban({ gh })
  const first = board.moveToColumn(1, '人間待ち')
  assert.ok(first.warning.includes(SCOPE_HINT))
  const projectCalls = calls.filter((args) => args[0] === 'project').length
  const listed = board.listItems()
  assert.equal(listed.ok, false)
  assert.deepEqual(listed.items, [])
  assert.equal(calls.filter((args) => args[0] === 'project').length, projectCalls)
})

test('gh がない・オフラインのときも、例外を投げずに警告を返す', () => {
  for (const failure of [{ ok: false, missing: true }, { ok: false, timedOut: true }]) {
    const { gh } = fakeGh({ fail: () => failure })
    const board = createKanban({ gh })
    assert.equal(board.moveToColumn(3, 'Todo').ok, false)
    assert.equal(board.createHumanIssue({ title: 't', kind: '権限', path: 'p' }).ok, false)
  }
})

// ---- 状態の決め方（board.mjs） ----

const issue = (number, state = 'OPEN', isPr = false) => ({ number, state, isPr })

test('人の判断が止めている番号：blocks の #番号と issue 欄。done の判断は数えない', () => {
  assert.deepEqual(humanTargets(todo({ blocks: '#12 と PR #58', issue: '200' })), [12, 58, 200])
  const map = blockedBy([todo({ blocks: '#12' }), todo({ path: 'b', blocks: '#12 #13' }), todo({ blocks: '#14', status: 'done' })])
  assert.deepEqual([...map.keys()], [12, 13])
  assert.equal(map.get(12).length, 2)
})

test('列の決め方：人間待ち > 閉じた > 人の作業が済んだ > 進行中 > Refs で開けておいた > Todo', () => {
  const todos = [
    todo({ blocks: '#1' }),
    todo({ path: 'p2', issue: '4', status: 'done', decision: 'はい', decidedBy: 'kame', decidedAt: '2026-11-16' }),
  ]
  const items = new Map([[1, 'In Progress'], [2, 'Todo'], [3, 'Done'], [4, '人間待ち'], [5, 'Todo'], [6, 'Todo'], [7, 'Todo']])
  const plan = planBoard({
    issues: [issue(1), issue(2, 'CLOSED'), issue(3, 'CLOSED'), issue(4), issue(5), issue(6), issue(7), issue(8, 'OPEN', true)],
    todos,
    active: new Set([5]),
    merged: new Set([6]),
    items,
  })
  assert.deepEqual(plan.moves, [
    { number: 1, column: '人間待ち' },
    { number: 2, column: 'Done' },
    { number: 4, column: 'Done' },
    { number: 5, column: 'In Progress' },
    { number: 6, column: 'Done' },
  ])
  assert.deepEqual(plan.reopen, [])
  assert.deepEqual(plan.close.map((item) => [item.number, item.reason]), [[4, 'human-done'], [6, 'merged']])
})

test('人間待ちが残っているのに閉じた Issue は開け直す（PR の merge で閉じた #317 の形）', () => {
  const plan = planBoard({ issues: [issue(317, 'CLOSED')], todos: [todo({ blocks: '#317 旅の合言葉' })], items: new Map([[317, 'Done']]) })
  assert.deepEqual(plan.reopen.map((item) => item.number), [317])
  assert.deepEqual(plan.moves, [{ number: 317, column: '人間待ち' }])
})

test('最近閉じた Issue は、閉じた直後の競合で In Progress に戻っていても Done にそろえる（#424 と #444 の形）', () => {
  const issues = withRecentlyClosed([issue(1), issue(2, 'CLOSED')], [424, 444, 2, 424, 9])
  assert.deepEqual(issues.map((item) => [item.number, item.state]), [[1, 'OPEN'], [2, 'CLOSED'], [424, 'CLOSED'], [444, 'CLOSED'], [9, 'CLOSED']])
  // 閉じていても作業宣言は進行中に見える（merge の直後）。開け閉めはせず、カンバンにない #9 も動かさない
  const plan = planBoard({ issues, todos: [], active: new Set([1, 424, 444]), items: new Map([[1, 'In Progress'], [424, 'In Progress'], [444, 'In Progress'], [2, 'Done']]) })
  assert.deepEqual(plan.moves, [{ number: 424, column: 'Done' }, { number: 444, column: 'Done' }])
  assert.deepEqual(plan.reopen, [])
  assert.deepEqual(plan.close, [])
})

test('人間待ちが残る閉じた Issue が最近閉じた一覧にも入っていても、開け直しは 1 回だけ', () => {
  const issues = withRecentlyClosed([issue(317, 'CLOSED')], [317, 318])
  const plan = planBoard({ issues, todos: [todo({ blocks: '#317' })], items: new Map([[317, 'Done'], [318, 'Done']]) })
  assert.deepEqual(plan.reopen.map((item) => item.number), [317])
  assert.deepEqual(plan.moves, [{ number: 317, column: '人間待ち' }])
})

test('カンバンを読めないとき（トークンなし）は列を動かさず、開け閉めだけ決める', () => {
  const plan = planBoard({ issues: [issue(1, 'CLOSED'), issue(2)], todos: [todo({ blocks: '#1' })] })
  assert.deepEqual(plan.moves, [])
  assert.deepEqual(plan.reopen.map((item) => item.number), [1])
})

test('PR の Closes は、人間待ちの Issue だけ Refs にし、ハーネスの印を付ける', () => {
  const blocked = blockedBy([todo({ blocks: '#317' })])
  assert.equal(closingKeyword(317, blocked), 'Refs')
  assert.equal(closingKeyword('12', blocked), 'Closes')
  const body = rewriteClosing('説明\n\nCloses #317\nFixes #12', blocked)
  assert.match(body, /Refs #317/)
  assert.match(body, /Fixes #12/)
  assert.match(body, /<!-- harness:refs -->#317 は/)
  assert.equal(rewriteClosing('Closes #12', blocked), undefined)
  assert.equal(rewriteClosing(body, blocked), undefined, '書き換え済みなら何もしない')
})

test('merge 済みの PR から数えるのは、ハーネスが Refs にした Issue だけ（人が手で書いた Refs は数えない）', () => {
  const blocked = blockedBy([todo({ blocks: '#317' })])
  assert.deepEqual(heldIssues(rewriteClosing('Closes #317', blocked)), [317])
  assert.deepEqual(heldIssues('Refs #40（関連）'), [])
  assert.deepEqual(heldIssues(undefined), [])
})

test('人間待ちのコメント：見出しに「人間待ち」、必要なこと・止まっていること・終わったら', () => {
  const open = { ...todo({ id: '2026-11-07-x', blocks: '#12 の本番確認' }), sections: { 決めてほしいこと: 'A か B か <!-- 書き方 -->', 背景: '理由' } }
  const body = renderHumanComment(open, 'https://example.invalid/x')
  assert.ok(body.startsWith(commentMarker('2026-11-07-x')))
  assert.match(body, /^## ⏸ 人間待ち：X を決める$/m)
  assert.match(body, /\*\*必要なこと\*\*（権限）\nA か B か$/m)
  assert.match(body, /\*\*止まっていること\*\*\n#12 の本番確認/)
  assert.match(body, /npm run human -- done 2026-11-07-x/)
  const done = renderHumanComment({ ...open, status: 'done', decision: 'A', decidedBy: 'kame', decidedAt: '2026-11-16', sections: { 判断の理由: '安い' } }, 'u')
  assert.match(done, /^## ✅ 決まりました：X を決める$/m)
  assert.match(done, /A（kame、2026-11-16）/)
  assert.match(done, /\*\*理由\*\*：安い/)
})

test('コメントは 1 つの判断に 1 つ。変わったら書き換え、決まった判断で新しくは出さない', () => {
  const fileUrl = (path) => `u/${path}`
  const open = { ...todo({ id: 'x', blocks: '#12 #13' }), sections: { 決めてほしいこと: 'A か B か' } }
  const current = renderHumanComment(open, fileUrl(open.path))
  const existing = new Map([[12, [{ id: 1, body: current }, { id: 2, body: 'ほかの人のコメント' }]]])
  const first = planHumanComments({ todos: [open], existing, fileUrl })
  assert.deepEqual(first.create.map((item) => item.number), [13])
  assert.deepEqual(first.update, [])
  const decided = { ...open, status: 'done', decision: 'A', decidedBy: 'kame', decidedAt: '2026-11-16' }
  const second = planHumanComments({ todos: [decided], existing, fileUrl })
  assert.deepEqual(second.create, [], '13 にはまだ出していないので、決まってから新しく出さない')
  assert.deepEqual(second.update.map((item) => [item.number, item.id]), [[12, 1]])
})

test('開け直した印のある Issue は、Refs で開けておいた Issue と同じく、判断が済んだら閉じる', () => {
  assert.equal(hasHeldMarker([{ body: `${HELD_MARKER}人の判断・作業がまだ残っているので開け直しました` }]), true)
  assert.equal(hasHeldMarker([{ body: 'ふつうのコメント' }]), false)
  const plan = planBoard({ issues: [issue(317)], todos: [todo({ blocks: '#317', status: 'done' })], merged: new Set([317]) })
  assert.deepEqual(plan.close.map((item) => [item.number, item.reason]), [[317, 'merged']])
})

test('GitHub が閉じるキーワードはすべて Refs に書き換える（Fix、Closed、resolved など）', () => {
  const blocked = blockedBy([todo({ blocks: '#1 #2 #3 #4' })])
  const body = rewriteClosing('Fix #1\nClosed #2\nresolved #3\nclose #4\nPrefix #1', blocked)
  assert.match(body, /^Refs #1\nRefs #2\nRefs #3\nRefs #4\nPrefix #1/)
})

test('ハーネスが一度閉じた Issue を人が開け直したら、人の作業の Issue も merge 済みの Issue も閉じ直さない', () => {
  const todos = [todo({ issue: '4', status: 'done', decision: 'はい' })]
  const plan = planBoard({ issues: [issue(4), issue(6)], todos, merged: new Set([6]), closedOnce: new Set([4, 6]) })
  assert.deepEqual(plan.close, [])
})

test('閉じるキーワードの「Closes: #N」も Refs にし、「Closes owner/repo#N」は書き換えない', () => {
  const blocked = blockedBy([todo({ blocks: '#5 #6' })])
  const body = rewriteClosing('Closes: #5\nFixes o/r#6', blocked)
  assert.match(body, /^Refs #5\nFixes o\/r#6/, 'owner/repo 付きは別のリポジトリかもしれないので書き換えない')
  assert.deepEqual(heldIssues(body), [5], '書き換えた形を merge 後に数え直せる')
})

test('人が開け直したかは、コメントの順番で見分ける（ハーネスが新しい人間待ちで開け直したなら、また閉じてよい）', () => {
  const held = { body: `${HELD_MARKER}開け直しました` }
  const closed = { body: `${CLOSED_MARKER}閉じます` }
  assert.equal(reopenedByHuman([held, closed]), true)
  assert.equal(reopenedByHuman([held, closed, held]), false)
  assert.equal(reopenedByHuman([held]), false)
  assert.equal(reopenedByHuman([]), false)
})

test('merge 済みの PR の一覧が取れなかった実行では、カンバンの列を動かさない', () => {
  const items = new Map([[5, 'Todo']])
  assert.equal(boardItems(items, true), items)
  assert.equal(boardItems(items, false), undefined)
  const plan = planBoard({ issues: [issue(5)], todos: [], active: new Set([5]), items: boardItems(items, false) })
  assert.deepEqual(plan.moves, [])
})

test('ハーネスが一度閉じた印を見分ける（人が開け直したら、もう閉じない）', () => {
  assert.equal(hasClosedMarker([{ body: `${CLOSED_MARKER}人の判断・作業が済み…` }]), true)
  assert.equal(hasClosedMarker([{ body: `${HELD_MARKER}開け直しました` }]), false)
})

test('読めない番号（打ち間違い）は、コメントの計画から外す', () => {
  const open = { ...todo({ id: 'x', blocks: '#12 #999' }), sections: { 決めてほしいこと: 'A か B か' } }
  const plan = planHumanComments({ todos: [open], existing: new Map(), fileUrl: (p) => p, skip: new Set([999]) })
  assert.deepEqual(plan.create.map((item) => item.number), [12])
})

test('Discord のメッセージの番号と状態をコメントに覚えさせ、状態が変わったら同じ番号で書き換える合図を出す', () => {
  const fileUrl = (path) => `u/${path}`
  const open = { ...todo({ id: 'x', blocks: '#12 #13' }), sections: { 決めてほしいこと: 'A か B か' } }
  // 新しく送ったとき：作るコメントに番号と状態（人間待ち）の印が入る
  const first = planHumanComments({ todos: [open], existing: new Map(), fileUrl, discordIds: new Map([[open.path, '999']]) })
  assert.ok(first.create.every((item) => item.body.endsWith(discordMarker('999', 'waiting'))))
  assert.equal(discordPhaseFrom(first.create[0].body), 'waiting')
  // 次の実行：コメントから番号を読み戻せ、文面が同じなら書き換えない（毎回送り直さない）
  const existing = new Map([[12, [{ id: 1, body: first.create[0].body }]], [13, [{ id: 2, body: first.create[1].body }]]])
  assert.equal(discordIdOf(open, existing), '999')
  assert.deepEqual(planHumanComments({ todos: [open], existing, fileUrl }), { create: [], update: [] })
  // 決まって、Issue がまだ開いているとき：対応中に書き換える合図。印は残る
  const decided = { ...open, status: 'done', decision: 'A', decidedBy: 'kame', decidedAt: '2026-11-16' }
  const states = new Map([[12, 'OPEN'], [13, 'OPEN']])
  const plan = planHumanComments({ todos: [decided], existing, fileUrl, states })
  assert.deepEqual(plan.update.map((item) => [item.number, item.decided, item.discordChange, item.phase, item.discordId]), [[12, true, true, 'working', '999'], [13, true, true, 'working', '999']])
  assert.equal(discordIdFrom(plan.update[0].body), '999')
  assert.equal(discordPhaseFrom(plan.update[0].body), 'working')
  // 決まったコメントの文面だけが変わったとき：Discord を二重に書き換えない
  const afterWorking = new Map([[12, [{ id: 1, body: plan.update[0].body }]], [13, [{ id: 2, body: plan.update[1].body }]]])
  const again = planHumanComments({ todos: [{ ...decided, decision: 'A（言い直し）' }], existing: afterWorking, fileUrl, states })
  assert.equal(again.update[0].discordChange, false)
  // 止めていた Issue がすべて閉じたら：完了に書き換える合図
  const finished = planHumanComments({ todos: [decided], existing: afterWorking, fileUrl, states: new Map([[12, 'CLOSED'], [13, 'CLOSED']]) })
  assert.deepEqual(finished.update.map((item) => [item.discordChange, item.phase]), [[true, 'done'], [true, 'done']])
  // 片方だけ閉じたら：対応中のまま（書き換えない）
  assert.deepEqual(planHumanComments({ todos: [decided], existing: afterWorking, fileUrl, states: new Map([[12, 'CLOSED'], [13, 'OPEN']]) }).update, [])
})

test('状態の印がない古い「決まりました」のコメントは、一度だけ今の状態に書き換える', () => {
  const fileUrl = (path) => `u/${path}`
  const decided = { ...todo({ id: 'x', blocks: '#12' }), status: 'done', decision: 'A', decidedBy: 'kame', decidedAt: '2026-11-16' }
  const legacy = renderHumanComment(decided, fileUrl(decided.path)) + '\n<!-- harness:discord 999 -->'
  const plan = planHumanComments({ todos: [decided], existing: new Map([[12, [{ id: 1, body: legacy }]]]), fileUrl, states: new Map([[12, 'OPEN']]) })
  assert.deepEqual(plan.update.map((item) => [item.decided, item.discordChange, item.phase]), [[false, true, 'working']])
})

test('humanPhase：決まっていなければ人間待ち、開いた Issue が残れば対応中、すべて閉じたら完了', () => {
  const decided = { ...todo({ blocks: '#1 #2' }), status: 'done' }
  assert.equal(humanPhase(todo({ blocks: '#1' }), new Map([[1, 'CLOSED']])), 'waiting')
  assert.equal(humanPhase(decided, new Map([[1, 'CLOSED'], [2, 'OPEN']])), 'working')
  assert.equal(humanPhase(decided, new Map([[1, 'CLOSED'], [2, 'CLOSED']])), 'done')
  assert.equal(humanPhase(decided, new Map()), 'working')
})

test('人の判断が決まった Issue は、進行中の作業が見えなくても In Progress に置く（Todo に戻さない）', () => {
  const decided = { ...todo({ blocks: '#317' }), status: 'done' }
  const resumed = resumedBy([decided])
  assert.deepEqual([...resumed.keys()], [317])
  const plan = planBoard({ issues: [issue(317, 'OPEN')], todos: [decided], items: new Map([[317, '人間待ち']]), resumed })
  assert.deepEqual(plan.moves, [{ number: 317, column: 'In Progress' }])
  // 同じ Issue をまだ止めている判断があれば、人間待ちのまま
  const stillOpen = todo({ path: 'todo/humans/other.md', blocks: '#317' })
  assert.deepEqual([...resumedBy([decided, stillOpen]).keys()], [])
  // 人の作業として起票した Issue（issue 欄）は入れない（決まったら閉じるため）
  assert.deepEqual([...resumedBy([{ ...todo({ issue: '#9' }), status: 'done' }]).keys()], [])
})

test('判断を頼んだ人：asked_by のブランチの作業宣言の owner。なければ asked_by に書かれた名簿の人', () => {
  const members = [{ github: 'Takana-12', names: ['Takana'] }, { github: 'Lazyturtle0852', names: ['Lazyturtle0852'] }]
  const asked = { askedBy: 'feat/join-code-google-link（AI、Lazyturtle0852 の端末）' }
  assert.equal(askedBranch(asked), 'feat/join-code-google-link')
  assert.equal(askerOf(asked, [{ branch: 'feat/join-code-google-link', owner: 'Takana' }], members), 'Takana')
  assert.equal(askerOf(asked, [], members), 'Lazyturtle0852')
  assert.equal(askerOf({ askedBy: '' }, [], members), undefined)
  // 名前は「の端末」の前と完全に一致するときだけ。ブランチ名に名簿の名前が含まれても当てない
  assert.equal(askerOf({ askedBy: 'feat/takana-fix（AI、だれか の端末）' }, [], members), undefined)
  assert.equal(askerOf({ askedBy: 'feat/x（AI、Takana の端末）' }, [], members), 'Takana-12')
})

test('前のコメントに番号がない古い人間待ち：番号を足す書き換えになる（決まった合図は付かない）', () => {
  const fileUrl = (path) => `u/${path}`
  const open = { ...todo({ id: 'x', blocks: '#12' }), sections: { 決めてほしいこと: 'A か B か' } }
  const existing = new Map([[12, [{ id: 1, body: renderHumanComment(open, fileUrl(open.path)) }]]])
  const plan = planHumanComments({ todos: [open], existing, fileUrl, discordIds: new Map([[open.path, '5']]) })
  assert.deepEqual(plan.update.map((item) => [item.number, item.decided]), [[12, false]])
  assert.equal(discordIdFrom(plan.update[0].body), '5')
})

test('未着手の Issue の一覧には、進行中のものと、人を待っている Issue を入れない', () => {
  const issues = [{ number: 1 }, { number: 2 }, { number: 3, activeBranch: 'feat/x' }]
  assert.deepEqual(backlogIssues(issues, [todo({ blocks: '#2' })]).map((item) => item.number), [1])
  assert.deepEqual(backlogIssues(issues).map((item) => item.number), [1, 2])
})

test('担当が付いた Issue（人の判断が決まって戻ってきた作業など）は未着手に入れず、担当のいる一覧に出す', () => {
  const issues = [{ number: 1, assignees: [] }, { number: 2, assignees: ['Takana-12'] }, { number: 3, assignees: ['x'], activeBranch: 'feat/x' }]
  assert.deepEqual(backlogIssues(issues).map((item) => item.number), [1])
  assert.deepEqual(heldIssuesByAssignee(issues).map((item) => item.number), [2])
})

test('merge 済みの作業は、宣言が「進行中」のままでも完了とみなす。宣言だけの PR は数えない', () => {
  const merged = mergedWorkBranches([
    { title: 'feat: 口コミを表示する', headRefName: 'feat/place-reviews' },
    { title: '作業宣言: カンバンに一本化', headRefName: 'chore/kanban' },
  ])
  assert.deepEqual([...merged], ['feat/place-reviews'])
  assert.equal(isMergedWork({ branch: 'feat/place-reviews', ahead: 0 }, merged), true)
  assert.equal(isMergedWork({ branch: 'feat/place-reviews', ahead: 2 }, merged), false, 'merge のあとに続きの commit がある')
  assert.equal(isMergedWork({ branch: 'feat/place-reviews', ahead: 0, pr: { number: 9 } }, merged), false, '続きの PR が開いている')
  assert.equal(isMergedWork({ branch: 'chore/kanban', ahead: 0 }, merged), false)
})

test('「完了」でも PR が開いているあいだはレビュー待ちとして作業中に数え、merge か中止で終わりにする', () => {
  const merged = new Set(['feat/done'])
  const work = (status, over = {}) => ({ branch: 'feat/x', ahead: 1, ledger: { status }, ...over })
  assert.equal(isFinishedWork(work('完了', { pr: { number: 356 } }), merged), false, 'レビュー待ち：カンバンは In Progress のまま')
  assert.equal(isFinishedWork(work('完了'), merged), true, 'PR がなく merge もされていない完了')
  assert.equal(isFinishedWork(work('進行中', { pr: { number: 9 } }), merged), false)
  assert.equal(isFinishedWork(work('中止', { pr: { number: 9 } }), merged), true)
  assert.equal(isFinishedWork(work('進行中', { branch: 'feat/done', ahead: 0 }), merged), true, 'merge 済み')
})

test('merge 済みの PR の一覧が取れないときは、警告を出し mergedKnown を false にする', () => {
  const failing = (args) => (args.includes('merged') ? { ok: false, stderr: 'HTTP 502' } : { ok: true, stdout: '[]' })
  const broken = collectWork({ cwd: process.cwd(), runGh: failing })
  assert.equal(broken.mergedKnown, false)
  assert.ok(broken.warnings.some((warning) => warning.includes('merge 済みの PR の一覧を取れませんでした')))
  const working = collectWork({ cwd: process.cwd(), runGh: () => ({ ok: true, stdout: '[]' }) })
  assert.equal(working.mergedKnown, true)
})

test('人の判断の雛形に issue 欄があり、読める', () => {
  const text = renderHumanTemplate({ id: 'i', title: 't', kind: '権限', askedBy: 'a', created: '2026-11-07', issue: 42 })
  assert.equal(parseHumanTodo(text, 'p').issue, '42')
  assert.equal(parseHumanTodo(renderHumanTemplate({ id: 'i', title: 't', kind: '権限', askedBy: 'a', created: 'c' }), 'p').issue, '')
})

test('human add は gh なし（--no-kanban）でも todo/humans のファイルを作る', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-human-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const script = join(import.meta.dirname, '..', 'human.mjs')
    const result = spawnSync('node', [script, 'add', 'try-it', '--title', '試す', '--kind', '権限', '--blocks', '#9'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HARNESS_OFFLINE: '1' },
    })
    assert.equal(result.status, 0, result.stderr)
    const [file] = readdirSync(join(dir, 'todo/humans'))
    const saved = parseHumanTodo(readFileSync(join(dir, 'todo/humans', file), 'utf8'), file)
    assert.equal(saved.blocks, '#9')
    assert.equal(saved.issue, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// PATH の先頭に置く偽物の gh。FAKE_GH=scope なら project の権限不足、ok なら起票と項目の追加に答える
const FAKE_GH = `#!/usr/bin/env node
const [a, b] = process.argv.slice(2)
require('node:fs').appendFileSync(process.env.FAKE_GH_LOG, process.argv.slice(2).join(' ') + '\\n')
if (process.env.FAKE_GH === 'scope' && a === 'project') { console.error('your authentication token is missing required scopes [project]'); process.exit(1) }
const out = (v) => { console.log(typeof v === 'string' ? v : JSON.stringify(v)); process.exit(0) }
if (a === 'repo') out({ nameWithOwner: 'o/r', url: 'https://github.com/o/r' })
if (a === 'issue' && b === 'create') out('https://github.com/o/r/issues/321')
if (a === 'api') out('https://github.com/o/r/issues/321')
if (a === 'project' && b === 'view') out({ id: 'PVT' })
if (a === 'project' && b === 'field-list') out(${JSON.stringify(FIELDS)})
if (a === 'project' && b === 'item-add') out({ id: 'ITEM' })
out('')
`

// Windows では Node が拡張子のない偽の gh を PATH から探さず、本物の gh を呼んでしまう。偽物を置けないので飛ばす（CI の Linux では走る）
const FAKE_GH_SKIP = process.platform === 'win32' && '偽の gh を PATH に置けない（Windows）'

function runHuman(args, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-human-gh-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  spawnSync('git', ['init', '-q'], { cwd: dir })
  const result = spawnSync('node', [join(import.meta.dirname, '..', 'human.mjs'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_OFFLINE: '', FAKE_GH: mode, FAKE_GH_LOG: join(dir, 'gh.log'), PATH: `${bin}:${process.env.PATH}` },
  })
  const files = readdirSync(join(dir, 'todo/humans'))
  const saved = files.map((file) => parseHumanTodo(readFileSync(join(dir, 'todo/humans', file), 'utf8'), file))
  let calls = []
  try {
    calls = readFileSync(join(dir, 'gh.log'), 'utf8').split('\n').filter(Boolean)
  } catch {}
  rmSync(dir, { recursive: true, force: true })
  return { result, saved, calls }
}

test('human add：止めている番号がなければ、人の作業を起票して issue 欄に書き戻す。カンバンは手元で動かさない', { skip: FAKE_GH_SKIP }, () => {
  const { result, saved, calls } = runHuman(['add', 'try-it', '--title', '試す', '--kind', '権限'], 'ok')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(saved[0].issue, '321')
  assert.match(result.stdout, /Issue #321 として起票しました/)
  assert.ok(!calls.some((line) => line.startsWith('project')), calls.join('\n'))
})

/** 手元だけ（HARNESS_OFFLINE=1）で human.mjs を続けて動かし、todo/humans/ の中身を返す */
function runHumanOffline(steps) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-human-prod-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const results = steps.map((args) =>
      spawnSync('node', [join(import.meta.dirname, '..', 'human.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, HARNESS_OFFLINE: '1' } }),
    )
    const folder = join(dir, 'todo/humans')
    const files = existsSync(folder) ? readdirSync(folder) : []
    return { results, files: Object.fromEntries(files.map((file) => [file, readFileSync(join(folder, file), 'utf8')])) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('human add：本番での確認は作らずに prod-check へ案内し、--not-prod-check なら仮の例外の行を入れる。末尾 prod-check の名前も止める', () => {
  const stopped = runHumanOffline([['add', 'pwa-bottom', '--title', 'PWA でしおりの下端を確かめる', '--kind', 'その他']])
  assert.equal(stopped.results[0].status, 1)
  assert.match(stopped.results[0].stderr, /npm run human -- prod-check/)
  assert.deepEqual(stopped.files, {}, 'ファイルを作らない')

  const passed = runHumanOffline([['add', 'pwa-icon', '--title', 'PWA のアイコンの確認の手順を決める', '--kind', 'その他', '--not-prod-check']])
  assert.equal(passed.results[0].status, 0, passed.results[0].stderr)
  const [text] = Object.values(passed.files)
  assert.match(text, /@harness-exception prod-check-bundle （本番での確認でない理由）/)
  assert.equal(validateProdCheckBundles([parseHumanTodo(text, 'x')]).length, 1, '仮の理由のままなら CI が止める')

  const named = runHumanOffline([['add', 'foo-prod-check', '--title', '費用', '--kind', '費用']])
  assert.equal(named.results[0].status, 1)
  assert.deepEqual(named.files, {})
})

test('human prod-check：まとめがなければ作り、2 回目は同じまとめに続きの番号で足す', () => {
  const { results, files } = runHumanOffline([
    ['prod-check', '--title', '旅の再生の一時停止', '--from', '#374'],
    ['prod-check', '--title', 'PWA でしおりを開く'],
  ])
  for (const result of results) assert.equal(result.status, 0, result.stderr)
  const names = Object.keys(files)
  assert.equal(names.length, 1, '別の項目を作らない')
  assert.match(names[0], /^\d{4}-\d{2}-\d{2}-prod-check\.md$/)
  const todo = parseHumanTodo(files[names[0]], names[0])
  assert.ok(isProdCheckBundle(todo))
  assert.match(todo.sections['決めてほしいこと'], /### 1\. 旅の再生の一時停止（#374）[^]*### 2\. PWA でしおりを開く/)
  assert.deepEqual(validateProdCheckBundles([todo]), [])
})

test('human prod-check：まとめを作るときは、人の作業の Issue を起票して issue 欄に書き戻す', { skip: FAKE_GH_SKIP }, () => {
  const { result, saved } = runHuman(['prod-check', '--title', '旅の再生の一時停止'], 'ok')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(saved.length, 1)
  assert.ok(isProdCheckBundle(saved[0]))
  assert.equal(saved[0].issue, '321')
  assert.match(result.stdout, /Issue #321/)
})

test('human add：blocks に #番号があれば起票せず、project の権限も使わない', () => {
  const { result, saved, calls } = runHuman(['add', 'try-it', '--title', '試す', '--kind', '権限', '--blocks', '#9'], 'scope')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(saved[0].issue, '')
  assert.deepEqual(calls, [])
  assert.match(result.stdout, /GitHub Actions/)
})

test('宣言をまとめて読む（git cat-file --batch）：長さはバイトで数え、ないものは undefined。git show と同じく前後の空白を落とす（2026-11-22）', async () => {
  const { parseCatFileBatch } = await import('../lib/work-index.mjs')
  const body = '---\nbranch: feat/x\n---\n# 日本語の宣言\n'
  const bytes = Buffer.byteLength(body)
  const output = Buffer.from(`aaaa blob ${bytes}\n${body}\nb:docs/work/none.md missing\ncccc blob 3\nabc\n`)
  const result = parseCatFileBatch(output, ['a:docs/work/x.md', 'b:docs/work/none.md', 'c:docs/work/y.md'])
  assert.equal(result.get('a:docs/work/x.md'), body.trim())
  assert.equal(result.get('b:docs/work/none.md'), undefined)
  assert.equal(result.get('c:docs/work/y.md'), 'abc')
})
