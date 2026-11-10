// 人の判断の記録（todo/humans/）を、今のブランチのまま main へ入れる処理を、一時リポジトリと裸のリモートで実際に動かす。
// 作業ブランチの未 commit の変更を消さないこと、todo/humans/ のほかは入れないこと、先に main が進んでいてもやり直せることを確かめる。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { changedHumansRecords, isHumansRecord, isRacedWithMain, publishHumans } from '../lib/publish-humans.mjs'

let base
let repo
let other

const git = (args, cwd = repo) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })
const ok = (result, message) => assert.equal(result.status, 0, `${message}\n${result.stdout}${result.stderr}`)
const write = (dir, path, text) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}
const onMain = (path) => git(['show', `origin/main:${path}`]).stdout

function configure(cwd) {
  for (const [key, value] of [['user.name', 'tester'], ['user.email', 'tester@example.invalid'], ['core.autocrlf', 'false']]) ok(git(['config', key, value], cwd), key)
}

before(() => {
  base = mkdtempSync(join(tmpdir(), 'harness-publish-'))
  const remote = join(base, 'remote.git')
  repo = join(base, 'repo')
  other = join(base, 'other')
  ok(git(['init', '-q', '--bare', '--initial-branch=main', remote], base), 'リモートを作る')
  mkdirSync(repo)
  ok(git(['init', '-q', '--initial-branch=main'], repo), 'リポジトリを作る')
  configure(repo)
  write(repo, 'README.md', 'test\n')
  write(repo, 'todo/humans/2026-11-08-old.md', 'status: open\n')
  ok(git(['add', '.']), 'add')
  ok(git(['commit', '-q', '-m', 'chore: 最初の commit']), '最初の commit')
  ok(git(['remote', 'add', 'origin', remote]), 'remote')
  ok(git(['push', '-q', '-u', 'origin', 'main']), 'push')
  ok(git(['clone', '-q', remote, other], base), 'ほかの人の clone')
  configure(other)
  ok(git(['switch', '-q', '-c', 'feat/work']), '作業ブランチ')
  write(repo, 'web/app.ts', 'export {}\n')
  ok(git(['add', 'web/app.ts']), 'add')
  ok(git(['commit', '-q', '-m', 'feat: 作業']), '作業の commit')
})

after(() => rmSync(base, { recursive: true, force: true }))

test('入れてよいのは todo/humans/ の下の .md だけ', () => {
  assert.equal(isHumansRecord('todo/humans/2026-11-08-a.md'), true)
  for (const path of ['web/app.ts', 'todo/humans/x.txt', 'todo/humans/../web/app.md', 'docs/todo/humans/a.md']) {
    assert.equal(isHumansRecord(path), false, path)
  }
})

test('作業ブランチのまま、判断の記録だけを main に入れ、ほかの未 commit の変更は残す', () => {
  write(repo, 'todo/humans/2026-11-08-old.md', 'status: done\n')
  write(repo, 'todo/humans/2026-11-08-new.md', 'status: open\n')
  write(repo, 'web/app.ts', 'export const wip = 1\n') // 人の作業中の変更（消してはいけない）
  assert.deepEqual(changedHumansRecords(repo).sort(), ['todo/humans/2026-11-08-new.md', 'todo/humans/2026-11-08-old.md'])

  const before = git(['rev-parse', 'origin/main']).stdout.trim()
  const result = publishHumans({ root: repo, files: changedHumansRecords(repo), message: 'docs: 人の判断を記録する' })
  assert.equal(result.ok, true, result.message)
  const changed = git(['diff', '--name-only', before, 'origin/main']).stdout.trim().split('\n').sort()
  assert.deepEqual(changed, ['todo/humans/2026-11-08-new.md', 'todo/humans/2026-11-08-old.md'], 'main に記録のほかが入った')
  assert.equal(onMain('todo/humans/2026-11-08-old.md'), 'status: done\n')
  assert.equal(onMain('todo/humans/2026-11-08-new.md'), 'status: open\n')
  // 作業ブランチの commit も、未 commit の変更も main に入らない
  assert.equal(git(['show', 'origin/main:web/app.ts']).status === 0, false, '作業ブランチのファイルが main に入った')
  // 作業ツリーの変更は残り、ブランチは feat/work のまま。一時的な作業ツリーは残らない
  assert.equal(readFileSync(join(repo, 'web/app.ts'), 'utf8'), 'export const wip = 1\n')
  assert.equal(git(['branch', '--show-current']).stdout.trim(), 'feat/work')
  assert.equal(git(['worktree', 'list']).stdout.trim().split('\n').length, 1)
  // 記録は手元にも同じ内容が残る（未 commit の変更があるので取り込みはせず、HEAD の版に戻すか、新しいものは消す）
  assert.equal(readFileSync(join(repo, 'todo/humans/2026-11-08-old.md'), 'utf8'), 'status: open\n')
  assert.equal(existsSync(join(repo, 'todo/humans/2026-11-08-new.md')), false)
  ok(git(['checkout', '--', 'web/app.ts']), '後片付け')
})

test('未 commit の変更がなければ、main を取り込んで手元にも記録が入る', () => {
  write(repo, 'todo/humans/2026-11-08-third.md', 'status: open\n')
  const result = publishHumans({ root: repo, files: ['todo/humans/2026-11-08-third.md'], message: 'docs: 記録' })
  assert.equal(result.ok, true, result.message)
  assert.equal(readFileSync(join(repo, 'todo/humans/2026-11-08-third.md'), 'utf8'), 'status: open\n')
  assert.equal(readFileSync(join(repo, 'todo/humans/2026-11-08-new.md'), 'utf8'), 'status: open\n', '前に入れた記録も取り込まれる')
})

test('ほかの人が先に main を進めていても、取り直して入れる', () => {
  ok(git(['pull', '-q', 'origin', 'main'], other), 'ほかの人の pull')
  write(other, 'README.md', 'changed\n')
  ok(git(['commit', '-qam', 'docs: README'], other), 'ほかの人の commit')
  ok(git(['push', '-q', 'origin', 'main'], other), 'ほかの人の push')
  // 手元の origin/main は古いまま
  write(repo, 'todo/humans/2026-11-08-fourth.md', 'status: open\n')
  const result = publishHumans({ root: repo, files: ['todo/humans/2026-11-08-fourth.md'], message: 'docs: 記録' })
  assert.equal(result.ok, true, result.message)
  assert.equal(onMain('README.md'), 'changed\n', 'ほかの人の変更を消した')
  assert.equal(onMain('todo/humans/2026-11-08-fourth.md'), 'status: open\n')
})

test('todo/humans/ のほかのファイルは受け付けず、同じ内容なら何もしない', () => {
  assert.equal(publishHumans({ root: repo, files: ['web/app.ts'], message: 'docs: x' }).ok, false)
  const same = publishHumans({ root: repo, files: ['todo/humans/2026-11-08-fourth.md'], message: 'docs: x' })
  assert.equal(same.ok, true)
  assert.equal(same.pushed, '')
})

test('push の失敗のうち、main が先に進んだためのものだけをやり直す', () => {
  assert.equal(isRacedWithMain(' ! [rejected]        HEAD -> main (fetch first)'), true)
  assert.equal(isRacedWithMain(' ! [rejected]        HEAD -> main (non-fast-forward)'), true)
  assert.equal(isRacedWithMain('[ハーネス] この push は止めました\n  - main へは push しません。…。例外は todo/humans/ だけを変える commit で、これは main へ直接 push してよい。先に `git pull` で main を取り込みます'), true)
  assert.equal(isRacedWithMain('[ハーネス] この push は止めました\n  - …。ほかのファイルが入っています：web/app.ts'), false)
  assert.equal(isRacedWithMain('fatal: Authentication failed'), false)
})

test('このブランチで commit 済みの記録は、手元を古い版に戻さない', () => {
  ok(git(['pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main']), '取り込む')
  write(repo, 'todo/humans/2026-11-08-branch.md', 'status: open\n')
  ok(git(['add', 'todo/humans/2026-11-08-branch.md']), 'add')
  ok(git(['commit', '-q', '-m', 'docs: ブランチで頼む']), 'ブランチで commit')
  write(repo, 'todo/humans/2026-11-08-branch.md', 'status: done\n')
  const result = publishHumans({ root: repo, files: ['todo/humans/2026-11-08-branch.md'], message: 'docs: 記録' })
  assert.equal(result.ok, true, result.message)
  assert.deepEqual(result.kept, ['todo/humans/2026-11-08-branch.md'])
  assert.equal(readFileSync(join(repo, 'todo/humans/2026-11-08-branch.md'), 'utf8'), 'status: done\n', '古い open の版に戻した')
  // 同じ内容をこのブランチでも commit すれば、main を取り込んでもぶつからない
  ok(git(['commit', '-qam', 'docs: 記録']), 'ブランチでも commit')
  ok(git(['merge', '-q', '--no-edit', 'origin/main']), 'main とぶつからない')
})

test('git hooks を入れた環境でも入り、ほかの人が先に main を進めていたらやり直して入れる', () => {
  const source = join(import.meta.dirname, '..', '..', '..')
  const hooked = join(base, 'hooked')
  const remote = join(base, 'hooked.git')
  const rival = join(base, 'rival')
  ok(git(['init', '-q', '--bare', '--initial-branch=main', remote], base), 'リモート')
  mkdirSync(hooked)
  ok(git(['init', '-q', '--initial-branch=main'], hooked), 'リポジトリ')
  configure(hooked)
  cpSync(join(source, 'scripts/harness'), join(hooked, 'scripts/harness'), { recursive: true })
  cpSync(join(source, '.githooks'), join(hooked, '.githooks'), { recursive: true })
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) chmodSync(join(hooked, '.githooks', hook), 0o755)
  write(hooked, 'README.md', 'test\n')
  ok(git(['add', '.'], hooked), 'add')
  ok(git(['commit', '-q', '--no-verify', '-m', 'chore: 最初の commit'], hooked), '準備')
  ok(git(['remote', 'add', 'origin', remote], hooked), 'remote')
  ok(git(['push', '-q', '--no-verify', 'origin', 'main'], hooked), '準備の push')
  ok(git(['config', 'core.hooksPath', '.githooks'], hooked), 'hooks を有効にする')
  ok(git(['clone', '-q', remote, rival], base), 'ほかの人')
  configure(rival)
  ok(git(['switch', '-q', '-c', 'feat/hooked'], hooked), '作業ブランチ')
  // pre-push のチェックが記録の形を見るので、本物の記録の形にする
  const sample = readFileSync(join(source, 'todo/humans/2026-11-08-decide-in-chat.md'), 'utf8')
  const record = (id) => sample.replace(/^id: .*$/m, `id: ${id}`).replace(/^issue: .*$/m, 'issue: ')

  write(hooked, 'todo/humans/2026-11-08-a.md', record('2026-11-08-a'))
  const first = publishHumans({ root: hooked, files: ['todo/humans/2026-11-08-a.md'], message: 'docs: 人の判断を記録する（a）' })
  assert.equal(first.ok, true, first.message)

  // ほかの人が main を進めた。手元の origin/main は古い
  write(rival, 'todo/humans/2026-11-08-rival.md', record('2026-11-08-rival'))
  ok(git(['pull', '-q', 'origin', 'main'], rival), 'pull')
  ok(git(['add', '.'], rival), 'add')
  ok(git(['commit', '-q', '--no-verify', '-m', 'docs: ほかの人の記録'], rival), 'commit')
  ok(git(['push', '-q', '--no-verify', 'origin', 'main'], rival), 'push')
  write(hooked, 'todo/humans/2026-11-08-b.md', record('2026-11-08-b'))
  const second = publishHumans({ root: hooked, files: ['todo/humans/2026-11-08-b.md'], message: 'docs: 人の判断を記録する（b）' })
  assert.equal(second.ok, true, second.message)
  assert.equal(git(['show', 'origin/main:todo/humans/2026-11-08-rival.md'], hooked).stdout, record('2026-11-08-rival'), 'ほかの人の記録を消した')
  assert.equal(git(['show', 'origin/main:todo/humans/2026-11-08-b.md'], hooked).stdout, record('2026-11-08-b'))
})
