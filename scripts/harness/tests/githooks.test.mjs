// git hooks を、一時リポジトリと裸のリモートで実際に動かす（モックではなく本物の git）。
// どの AI も人も通る層なので、ここが漏れないことを確かめる。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderLedgerTemplate } from '../lib/ledger.mjs'

const source = fileURLToPath(new URL('../../..', import.meta.url))
let base
let repo
let remote

const git = (args, cwd = repo) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })
const ok = (result, message) => assert.equal(result.status, 0, `${message}\n${result.stdout}${result.stderr}`)
const blocked = (result, pattern, message) => {
  assert.notEqual(result.status, 0, `${message} が止まらなかった\n${result.stdout}`)
  if (pattern) assert.match(result.stderr + result.stdout, pattern, message)
}
const write = (path, text) => {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

const ledger = (branch) =>
  renderLedgerTemplate({ branch, title: 'テスト', owner: 't', agent: 't', started: '2026-11-07', scope: ['web/src/**', 'notes.md'] })
    .replace(/(## 目的\n\n)<!--[^]*?-->/, '$1テストのため')
    .replace(/- \[ \][ \t]*\n/, '- [ ] フックが動く\n')
    .replace(/(## 正本への影響\n\n)<!--[^]*?-->/, '$1なし')

// push の前の形チェック（人の判断）に通る、open の項目
const HUMAN_ITEM = [
  '---',
  'id: 2026-11-07-x',
  'title: テストの判断',
  'status: open',
  'kind: 方針',
  'asked_by: テスト',
  'created: 2026-11-07',
  'blocks: ',
  'decided_by:',
  'decided_at:',
  'decision:',
  '---',
  '',
  '# テストの判断',
  '',
  '## 決めてほしいこと',
  '',
  'A と B のどちらにするか。',
  '',
].join('\n')

before(() => {
  base = mkdtempSync(join(tmpdir(), 'harness-githooks-'))
  repo = join(base, 'repo')
  remote = join(base, 'remote.git')
  mkdirSync(repo)
  ok(git(['init', '--bare', '--initial-branch=main', remote], base), 'リモートを作る')
  ok(git(['init', '--initial-branch=main']), 'リポジトリを作る')
  for (const [key, value] of [['user.name', 'tester'], ['user.email', 'tester@example.invalid'], ['core.autocrlf', 'false']]) ok(git(['config', key, value]), key)
  cpSync(join(source, 'scripts/harness'), join(repo, 'scripts/harness'), { recursive: true })
  cpSync(join(source, '.githooks'), join(repo, '.githooks'), { recursive: true })
  for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) chmodSync(join(repo, '.githooks', hook), 0o755)
  write('README.md', 'test\n')
  ok(git(['add', '.']), 'add')
  ok(git(['commit', '--no-verify', '-m', 'chore: 最初の commit']), '最初の commit（準備なので hooks なし）')
  ok(git(['remote', 'add', 'origin', remote]), 'remote')
  ok(git(['push', '--no-verify', 'origin', 'main']), '最初の push（準備）')
  ok(git(['config', 'core.hooksPath', '.githooks']), 'hooks を有効にする')
})

after(() => rmSync(base, { recursive: true, force: true }))

test('main では commit できない', () => {
  write('notes.md', 'x\n')
  ok(git(['add', 'notes.md']), 'add')
  blocked(git(['commit', '-m', 'docs: メモ']), /main には commit しません/, 'main への commit')
  ok(git(['reset', '-q']), '片付け')
})

test('main でも、todo/humans/ だけの commit と push は通る。ほかが混ざれば止まる', () => {
  write('todo/humans/2026-11-07-x.md', HUMAN_ITEM)
  write('notes.md', 'y\n')
  ok(git(['add', 'todo/humans/2026-11-07-x.md', 'notes.md']), 'add')
  blocked(git(['commit', '-m', 'docs: 判断とメモ']), /main には commit しません/, 'todo/humans/ とほかが混ざった commit')
  ok(git(['reset', '-q', 'notes.md']), 'メモを外す')
  ok(git(['commit', '-m', 'docs: 判断を記録する']), 'todo/humans/ だけの commit')
  ok(git(['push', 'origin', 'main']), 'todo/humans/ だけの push')
  // hooks を飛ばして混ぜた commit は、push で止まる
  ok(git(['add', 'notes.md']), 'add')
  ok(git(['commit', '--no-verify', '-m', 'docs: メモ']), 'hooks を飛ばした commit（準備）')
  blocked(git(['push', 'origin', 'main']), /ほかのファイルが入っています/, 'ほかのファイルを含む main への push')
  ok(git(['reset', '-q', '--hard', 'origin/main']), '片付け')
  // ほかのファイルを todo/humans/ へ移す（rename）と、移動元の削除が入るので止まる
  ok(git(['mv', 'README.md', 'todo/humans/2026-11-07-moved.md']), '移動')
  blocked(git(['commit', '-m', 'docs: 移す']), /main には commit しません/, 'todo/humans/ への移動の commit')
  ok(git(['commit', '--no-verify', '-m', 'docs: 移す']), 'hooks を飛ばした移動の commit（準備）')
  blocked(git(['push', 'origin', 'main']), /README\.md/, 'todo/humans/ への移動を含む main への push')
  ok(git(['reset', '-q', '--hard', 'origin/main']), '片付け')
})

test('人が main を deploy へ早送りで反映する push は通る。書き換えと削除は止まる', () => {
  ok(git(['push', 'origin', 'main:deploy']), '初回の反映（deploy を作る）')
  write('todo/humans/2026-11-07-y.md', HUMAN_ITEM.replace('テストの判断', 'テストの判断 2'))
  ok(git(['add', 'todo/humans/2026-11-07-y.md']), 'add')
  ok(git(['commit', '-m', 'docs: 判断を記録する']), 'todo/humans/ だけの commit')
  ok(git(['push', 'origin', 'main']), 'main へ push')
  ok(git(['push', 'origin', 'origin/main:deploy']), '2 回目の反映（早送り）')
  blocked(git(['push', '--force', 'origin', 'main~1:deploy']), /force push/, 'deploy の履歴を戻す push')
  blocked(git(['push', 'origin', ':deploy']), /消す push/, 'deploy を消す push')
})

test('作業ブランチでは、決まりに合う commit だけ通る', () => {
  ok(git(['switch', '-c', 'feat/hooks-test']), 'ブランチ')
  write('notes.md', 'x\n')
  ok(git(['add', 'notes.md']), 'add')
  blocked(git(['commit', '-m', 'update']), /commit メッセージ/, '形の合わない commit メッセージ')
  ok(git(['commit', '-m', 'docs: メモを足す']), '形の合う commit')
})

test('秘密情報と、置いてはいけないファイルは commit に入れられない', () => {
  write('web/src/shared/config/keys.ts', `export const key = '${['AI', 'za', 'Sy', 'B'.repeat(33)].join('')}'\n`)
  ok(git(['add', 'web/src/shared/config/keys.ts']), 'add')
  blocked(git(['commit', '-m', 'feat: キーを足す']), /秘密情報/, '秘密情報')
  ok(git(['reset', '-q']), '片付け')
  write('web/.env.local', 'VITE_X=1\n')
  ok(git(['add', '-f', 'web/.env.local']), 'add -f')
  blocked(git(['commit', '-m', 'chore: 設定']), /置いてはいけない/, '.env')
  ok(git(['reset', '-q']), '片付け')
  rmSync(join(repo, 'web/.env.local'))
  rmSync(join(repo, 'web/src/shared/config/keys.ts'))
})

test('層の違反は commit で止まる', () => {
  write('web/src/components/Button.tsx', 'export const Button = () => null\n')
  ok(git(['add', 'web/src/components/Button.tsx']), 'add')
  blocked(git(['commit', '-m', 'feat: ボタン']), /layer\/placement/, '層にない場所')
  ok(git(['reset', '-q']), '片付け')
  rmSync(join(repo, 'web/src/components'), { recursive: true })
})

test('作業宣言のないブランチは push できず、宣言を置けば push できる', () => {
  blocked(git(['push', '-u', 'origin', 'feat/hooks-test']), /作業宣言/, '宣言のない push')
  write('docs/work/feat-hooks-test.md', ledger('feat/hooks-test'))
  ok(git(['add', 'docs/work/feat-hooks-test.md']), 'add')
  ok(git(['commit', '-m', 'docs: 作業を宣言する']), '宣言の commit')
  ok(git(['push', '-u', 'origin', 'feat/hooks-test']), '宣言のある push')
})

test('main への push、force push、リモートのブランチの削除は止まる', () => {
  blocked(git(['push', 'origin', 'HEAD:main']), /main へは push しません/, 'main への push')
  ok(git(['commit', '--amend', '--no-verify', '-m', 'docs: 作業を宣言し直す']), '履歴を書き換える（準備）')
  blocked(git(['push', '--force', 'origin', 'feat/hooks-test']), /force push/, 'force push')
  blocked(git(['push', 'origin', ':feat/hooks-test']), /消す push/, 'リモートのブランチの削除')
})

test('決まりに合わない名前のブランチは push できない', () => {
  ok(git(['switch', '-c', 'my-branch']), 'ブランチ')
  blocked(git(['push', 'origin', 'my-branch']), /ブランチ名/, '名前の合わないブランチ')
})
