// 作業の始めに main の最新を取り込む処理を、一時リポジトリと裸のリモートで実際に動かす（モックではなく本物の git）。
// 人の変更を消さないこと、ぶつかったら元に戻すことを確かめる。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { shouldSyncOnStart } from '../lib/session-context.mjs'
import { describeSync, syncWithMain } from '../lib/sync-main.mjs'

let base
let repo
let other

const git = (args, cwd = repo) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })
const ok = (result, message) => assert.equal(result.status, 0, `${message}\n${result.stdout}${result.stderr}`)
const write = (dir, path, text) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}
const head = (cwd = repo) => git(['rev-parse', 'HEAD'], cwd).stdout.trim()

function configure(cwd) {
  for (const [key, value] of [['user.name', 'tester'], ['user.email', 'tester@example.invalid'], ['core.autocrlf', 'false']]) ok(git(['config', key, value], cwd), key)
}

/** ほかの人が main に commit して push したことにする */
function advanceMain(path, text) {
  ok(git(['pull', '-q', '--no-rebase', 'origin', 'main'], other), 'ほかの人の pull')
  write(other, path, text)
  ok(git(['add', path], other), 'add')
  ok(git(['commit', '-q', '-m', `docs: ${path} を変える`], other), 'ほかの人の commit')
  ok(git(['push', '-q', 'origin', 'main'], other), 'ほかの人の push')
  ok(git(['fetch', '-q', 'origin']), '自分の fetch')
}

before(() => {
  base = mkdtempSync(join(tmpdir(), 'harness-sync-'))
  const remote = join(base, 'remote.git')
  repo = join(base, 'repo')
  other = join(base, 'other')
  ok(git(['init', '-q', '--bare', '--initial-branch=main', remote], base), 'リモートを作る')
  mkdirSync(repo)
  ok(git(['init', '-q', '--initial-branch=main'], repo), 'リポジトリを作る')
  configure(repo)
  write(repo, 'README.md', 'test\n')
  write(repo, 'shared.md', 'one\n')
  ok(git(['add', '.']), 'add')
  ok(git(['commit', '-q', '-m', 'chore: 最初の commit']), '最初の commit')
  ok(git(['remote', 'add', 'origin', remote]), 'remote')
  ok(git(['push', '-q', '-u', 'origin', 'main']), '最初の push')
  ok(git(['clone', '-q', remote, other], base), 'ほかの人の手元')
  configure(other)
})

after(() => rmSync(base, { recursive: true, force: true }))

test('main は、変更がなければ fast-forward で最新になる', () => {
  advanceMain('a.md', 'a\n')
  const result = syncWithMain(repo)
  assert.equal(result.state, 'fast-forwarded')
  assert.equal(result.behind, 1)
  assert.equal(head(), git(['rev-parse', 'origin/main']).stdout.trim())
  assert.equal(syncWithMain(repo).state, 'up-to-date')
})

test('作業ブランチは、変更がなければ origin/main を merge する', () => {
  ok(git(['switch', '-q', '-c', 'feat/sync-test']), 'ブランチ')
  write(repo, 'mine.md', 'mine\n')
  ok(git(['add', 'mine.md']), 'add')
  ok(git(['commit', '-q', '-m', 'feat: 自分の変更']), '自分の commit')
  advanceMain('b.md', 'b\n')
  const result = syncWithMain(repo)
  assert.equal(result.state, 'merged')
  assert.equal(git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).status, 0, 'origin/main が取り込まれている')
  assert.match(git(['log', '-1', '--format=%s']).stdout, /^Merge /, 'merge の commit になる（rebase しない）')
  assert.match(describeSync(result, 'feat/sync-test'), /merge しました/)
})

test('未 commit の変更があれば、何もしない', () => {
  advanceMain('c.md', 'c\n')
  write(repo, 'mine.md', 'mine, editing\n')
  const before = head()
  const result = syncWithMain(repo)
  assert.equal(result.state, 'dirty')
  assert.equal(head(), before, 'HEAD は動かない')
  assert.equal(readFileSync(join(repo, 'mine.md'), 'utf8'), 'mine, editing\n', '手元の変更は残る')
  assert.match(describeSync(result, 'feat/sync-test'), /取り込みませんでした/)
  ok(git(['commit', '-q', '-am', 'feat: 編集を終える']), '片付け')
  assert.equal(syncWithMain(repo).state, 'merged')
})

test('ぶつかったら取り消して、ぶつかったファイルを伝える', () => {
  write(repo, 'shared.md', 'mine\n')
  ok(git(['commit', '-q', '-am', 'feat: 共有のファイルを変える']), '自分の commit')
  advanceMain('shared.md', 'theirs\n')
  const before = head()
  const result = syncWithMain(repo)
  assert.equal(result.state, 'conflict')
  assert.deepEqual(result.conflicts, ['shared.md'])
  assert.equal(result.aborted, true)
  assert.equal(head(), before, 'HEAD は元のまま')
  assert.equal(git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status, 1, 'merge の途中で止まっていない')
  assert.equal(git(['status', '--porcelain']).stdout, '', '作業ツリーはきれいなまま')
  assert.match(describeSync(result, 'feat/sync-test'), /shared\.md/)
})

test('merge の途中なら、何もしない', () => {
  assert.notEqual(git(['merge', 'origin/main']).status, 0, 'ぶつかる merge を始める（準備）')
  const result = syncWithMain(repo)
  assert.equal(result.state, 'busy')
  ok(git(['merge', '--abort']), '片付け')
})

test('merge が時間内に終わらなければ打ち切り、途中の merge を残さない（PR #68 のレビュー）', () => {
  ok(git(['checkout', '-q', '-b', 'feat/sync-timeout', 'origin/main']), '別の作業ブランチ')
  write(repo, 'own.md', 'own\n')
  ok(git(['add', 'own.md']), 'add')
  ok(git(['commit', '-q', '-m', 'feat: 自分の commit']), '自分の commit')
  advanceMain('t.md', 't\n')
  const before = head()
  const result = syncWithMain(repo, { mergeTimeout: 1 })
  assert.equal(result.state, 'timeout')
  assert.equal(result.aborted, true)
  assert.equal(head(), before, 'HEAD は元のまま')
  assert.equal(git(['rev-parse', '-q', '--verify', 'MERGE_HEAD']).status, 1, 'merge の途中で止まっていない')
  assert.match(describeSync(result, 'feat/sync-timeout'), /打ち切りました/)
  assert.equal(syncWithMain(repo).state, 'merged', '時間があれば取り込める')
})

test('打ち切ったときの案内：取り消せなかった merge と、残った index.lock を伝える', () => {
  const text = describeSync({ state: 'timeout', behind: 2, aborted: false, locked: true }, 'feat/x')
  assert.match(text, /git merge --abort/)
  assert.match(text, /index\.lock/)
  assert.match(describeSync({ state: 'timeout', behind: 2, aborted: true, locked: false }, 'feat/x'), /元のまま/)
})

test('セッションの始めに取り込むのは、新しく始めたときだけ（resume と compact では取り込まない。PR #68 のレビュー）', () => {
  assert.equal(shouldSyncOnStart('startup'), true)
  assert.equal(shouldSyncOnStart('clear'), true)
  assert.equal(shouldSyncOnStart(undefined), true, 'source を渡さない AI（Codex、agy）は今までどおり取り込む')
  assert.equal(shouldSyncOnStart('resume'), false)
  assert.equal(shouldSyncOnStart('compact'), false)
})
