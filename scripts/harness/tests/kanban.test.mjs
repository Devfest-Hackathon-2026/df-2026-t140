// カンバン（GitHub Projects）との連動。gh は偽物を注入し、本物は叩かない。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseHumanTodo, renderHumanTemplate } from '../lib/humans.mjs'
import {
  classifyGhFailure,
  createKanban,
  findStatusOption,
  linkHumanTodo,
  parseBlockRefs,
  parseIssueRef,
  parseProjectItems,
  releaseHumanTodo,
  SCOPE_HINT,
  stillBlocked,
} from '../lib/kanban.mjs'
import { backlogIssues, collectHumanWaiting } from '../lib/work-index.mjs'

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

test('blocks に #番号があれば、その Issue を「人間待ち」にし、起票はしない', () => {
  const { gh, calls } = fakeGh()
  const result = linkHumanTodo({ todo: todo({ blocks: 'S12 の実装（#12）' }), kanban: createKanban({ gh }) })
  assert.equal(result.issue, undefined)
  assert.deepEqual(result.warnings, [])
  assert.ok(!calls.some((args) => args[0] === 'issue' && args[1] === 'create'))
  assert.deepEqual(edits(calls), [['ITEM_12', 'o_wait']])
  // Project と フィールドは 1 回だけ読む
  assert.equal(calls.filter((args) => args[1] === 'field-list').length, 1)
})

test('blocks に番号がなければ、人の作業を Issue として起票し「人間待ち」に置く', () => {
  const { gh, calls } = fakeGh()
  const result = linkHumanTodo({ todo: todo(), kanban: createKanban({ gh }) })
  assert.equal(result.issue, 200)
  const create = calls.find((args) => args[0] === 'issue' && args[1] === 'create')
  assert.equal(create[create.indexOf('--label') + 1], '人間待ち')
  assert.match(create[create.indexOf('--body') + 1], /https:\/\/github\.com\/o\/r\/blob\/main\/todo\/humans\/2026-11-07-x\.md/)
  assert.deepEqual(edits(calls), [['ITEM_200', 'o_wait']])
})

test('issue 欄がもうあれば起票し直さず、その Issue を「人間待ち」に置き直す', () => {
  const { gh, calls } = fakeGh()
  const result = linkHumanTodo({ todo: todo({ issue: '77' }), kanban: createKanban({ gh }) })
  assert.equal(result.issue, undefined)
  assert.ok(!calls.some((args) => args[1] === 'create'))
  assert.deepEqual(edits(calls), [['ITEM_77', 'o_wait']])
})

test('done：待っていた Issue を In Progress に戻し、人の作業の Issue は Done にして閉じる', () => {
  const { gh, calls } = fakeGh()
  const result = releaseHumanTodo({ todo: todo({ blocks: '#12', issue: '200', decision: 'はい', decidedBy: 'kame', decidedAt: '2026-11-07' }), openTodos: [], kanban: createKanban({ gh }) })
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(edits(calls), [['ITEM_12', 'o_prog'], ['ITEM_200', 'o_done']])
  const close = calls.find((args) => args[0] === 'issue' && args[1] === 'close')
  assert.equal(close[2], '200')
  assert.match(close[close.indexOf('--comment') + 1], /はい（kame、2026-11-07）/)
})

test('done：ほかの open な人の判断がまだ止めている Issue は「人間待ち」のまま', () => {
  const other = todo({ path: 'todo/humans/2026-11-07-y.md', blocks: '#12' })
  assert.equal(stillBlocked(12, [other], 'todo/humans/2026-11-07-x.md'), true)
  assert.equal(stillBlocked(12, [other], other.path), false)
  const { gh, calls } = fakeGh()
  const result = releaseHumanTodo({ todo: todo({ blocks: '#12' }), openTodos: [other], kanban: createKanban({ gh }) })
  assert.deepEqual(edits(calls), [])
  assert.match(result.notes[0], /人間待ち」のまま/)
})

test('project スコープがないとき：警告に gh auth refresh を出し、2 回目からは gh を呼ばない', () => {
  const scope = { ok: false, stderr: 'your authentication token is missing required scopes [project]' }
  const { gh, calls } = fakeGh({ fail: (args) => (args[0] === 'project' ? scope : undefined) })
  const board = createKanban({ gh })
  const first = linkHumanTodo({ todo: todo({ blocks: '#1 #2' }), kanban: board })
  assert.equal(first.warnings.length, 1)
  assert.ok(first.warnings[0].includes(SCOPE_HINT))
  const projectCalls = calls.filter((args) => args[0] === 'project').length
  assert.equal(projectCalls, 1)
  const listed = board.listColumn('人間待ち')
  assert.equal(listed.ok, false)
  assert.deepEqual(listed.items, [])
  assert.equal(calls.filter((args) => args[0] === 'project').length, projectCalls)
})

test('gh がない・オフラインのときも、例外を投げずに警告を返す', () => {
  for (const failure of [{ ok: false, missing: true }, { ok: false, timedOut: true }]) {
    const { gh } = fakeGh({ fail: () => failure })
    const board = createKanban({ gh })
    const linked = linkHumanTodo({ todo: todo(), kanban: board })
    assert.equal(linked.issue, undefined)
    assert.equal(linked.warnings.length, 1)
    const released = releaseHumanTodo({ todo: todo({ blocks: '#3', issue: '9' }), kanban: board })
    assert.equal(released.warnings.length, 1)
  }
})

test('status とセッションの始めに出す「人間待ち」の一覧は、その列の項目だけ', () => {
  const { gh } = fakeGh()
  const waiting = collectHumanWaiting(process.cwd(), { runGh: gh })
  assert.equal(waiting.ok, true)
  assert.equal(waiting.column, '人間待ち')
  assert.deepEqual(waiting.items.map((item) => item.number), [5])
})

test('未着手の Issue の一覧には、人を待っている Issue（ラベル 人間待ち）を入れない', () => {
  const issues = [
    { number: 1, labels: ['status:todo'] },
    { number: 2, labels: ['人間待ち'] },
    { number: 3, labels: [], activeBranch: 'feat/x' },
  ]
  assert.deepEqual(backlogIssues(issues).map((item) => item.number), [1])
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
    env: { ...process.env, HARNESS_OFFLINE: '', FAKE_GH: mode, PATH: `${bin}:${process.env.PATH}` },
  })
  const files = readdirSync(join(dir, 'todo/humans'))
  const saved = files.map((file) => parseHumanTodo(readFileSync(join(dir, 'todo/humans', file), 'utf8'), file))
  rmSync(dir, { recursive: true, force: true })
  return { result, saved }
}

test('human add：起票した Issue の番号を issue 欄に書き戻す', () => {
  const { result, saved } = runHuman(['add', 'try-it', '--title', '試す', '--kind', '権限'], 'ok')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(saved[0].issue, '321')
  assert.match(result.stdout, /#321 をカンバンの「人間待ち」に置きました/)
})

test('human add：project の権限がなくても、ファイルは作り、gh auth refresh を案内する', () => {
  const { result, saved } = runHuman(['add', 'try-it', '--title', '試す', '--kind', '権限', '--blocks', '#9'], 'scope')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(saved.length, 1)
  assert.ok(result.stdout.includes(SCOPE_HINT), result.stdout)
  assert.match(result.stdout, /npm run human -- sync/)
})
