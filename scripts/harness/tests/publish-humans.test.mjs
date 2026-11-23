// 人の判断の記録（todo/humans/）を、今のブランチのまま main へ入れる処理を、一時リポジトリと裸のリモートで実際に動かす。
// 作業ブランチの未 commit の変更を消さないこと、todo/humans/ のほかは入れないこと、先に main が進んでいてもやり直せることを確かめる。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { appendProdCheck } from '../lib/humans.mjs'
import { changedHumansRecords, isHumansRecord, isRacedWithMain, mergeWithMain, publishHumans, rememberBase } from '../lib/publish-humans.mjs'

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
  ok(git(['clone', '-q', '-c', 'core.autocrlf=false', remote, other], base), 'ほかの人の clone') // 取り出す前に改行の変換を止める（Windows の autocrlf=true で、全ファイルが変更ありに見えて pull が止まる）
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

test('同じ記録が main で先に変わっていたら、手元の版で上書きせず、重ねて入れる（本番での確認のまとめ）', () => {
  const path = 'todo/humans/2026-11-22-prod-check.md'
  const v1 = '---\nid: 2026-11-22-prod-check\nstatus: open\n---\n\n## 決めてほしいこと\n\n### 1. A\n\n- [ ] a\n\n## 背景\n\nなし\n'
  const pushFromOther = (text, message) => {
    write(other, path, text)
    ok(git(['add', path], other), 'add')
    ok(git(['commit', '-q', '-m', message], other), 'ほかの人の commit')
    ok(git(['push', '-q', 'origin', 'main'], other), 'ほかの人の push')
  }
  // AI-2（other）が main にまとめを作り、AI-1（repo）がそれを取り込む
  ok(git(['fetch', '-q', 'origin'], other), 'ほかの人の fetch')
  ok(git(['reset', '-q', '--hard', 'origin/main'], other), 'ほかの人を main にそろえる')
  pushFromOther(v1, 'docs: まとめを作る')
  ok(git(['pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main']), '取り込む')
  // AI-2 が 2 番を足して main に入れた。AI-1 の手元はまだ 1 番だけ
  const v2 = appendProdCheck(v1, { heading: 'B' })
  pushFromOther(v2, 'docs: 2 番を足す')

  // 古い手元の版に足して publish すると、同じ所を変えているので止まり、main の 2 番は消えない
  write(repo, path, appendProdCheck(v1, { heading: 'C' }))
  const stale = publishHumans({ root: repo, files: [path], message: 'docs: 記録' })
  assert.equal(stale.ok, false, '古い版で main を上書きした')
  assert.equal(onMain(path), v2)
  ok(git(['checkout', '--', path]), '手元の足し分を捨てる')

  // prod-check と同じく、main の版を取り、その版から作ったと記録して足せば、2 番も 3 番も残る
  // （このブランチが main から分かれたときの版は 1 番だけのまま。記録がないと、同じ所への書き足しとしてぶつかる）
  const latest = mergeWithMain(repo, path)
  assert.equal(latest.ok, true, latest.message)
  assert.equal(latest.text, v2)
  assert.equal(latest.main, v2)
  rememberBase(repo, path, latest.main)
  const v3 = appendProdCheck(latest.text, { heading: 'C' })
  assert.match(v3, /### 2\. B[^]*### 3\. C/)
  write(repo, path, v3)
  const appended = publishHumans({ root: repo, files: [path], message: 'docs: 記録' })
  assert.equal(appended.ok, true, appended.message)
  assert.equal(onMain(path), v3)
  assert.equal(existsSync(join(repo, '.harness/humans-base/feat/work', path)), false, '入れたあとも元の記録が残った')

  // 人が main で印を付けて done にした。手元の版が古くても、main の版を見て done と分かり、publish しても元に戻らない
  ok(git(['fetch', '-q', 'origin'], other), 'ほかの人の fetch')
  ok(git(['reset', '-q', '--hard', 'origin/main'], other), 'ほかの人を main にそろえる')
  const decided = v3.replace('status: open', 'status: done').replace('- [ ] a', '- [x] a')
  pushFromOther(decided, 'docs: 印を付けて done にする')
  ok(git(['fetch', '-q', 'origin']), '取り直す')
  assert.equal(mergeWithMain(repo, path).text, decided)
  const again = publishHumans({ root: repo, files: [path], message: 'docs: 記録' })
  assert.equal(again.ok, true, again.message)
  assert.equal(onMain(path), decided, '古い手元の版で、人の印と done を消した')
})

test('このブランチで commit 済みの記録を入れたあと、main で足されてから、もう一度変えて入れても止まらない', () => {
  const path = 'todo/humans/2026-11-22-kept.md'
  write(repo, path, 'a\nb\nc\nd\ne\n')
  ok(git(['add', path]), 'add')
  ok(git(['commit', '-q', '-m', 'docs: ブランチで頼む']), 'ブランチで commit')
  const first = publishHumans({ root: repo, files: [path], message: 'docs: 記録' })
  assert.equal(first.ok, true, first.message)
  assert.deepEqual(first.kept, [path])
  // ほかの人が main で末尾に足した。このブランチは main を取り込んでいない（merge-base にはこのファイルがない）
  ok(git(['fetch', '-q', 'origin'], other), 'ほかの人の fetch')
  ok(git(['reset', '-q', '--hard', 'origin/main'], other), 'ほかの人を main にそろえる')
  write(other, path, 'a\nb\nc\nd\ne\nf\n')
  ok(git(['commit', '-qam', 'docs: 足す'], other), 'ほかの人の commit')
  ok(git(['push', '-q', 'origin', 'main'], other), 'ほかの人の push')
  // 手元で 1 行目を変えて入れる。いま main に入れた版を元に重ねるので、ほかの人の f も残る
  write(repo, path, 'A\nb\nc\nd\ne\n')
  const second = publishHumans({ root: repo, files: [path], message: 'docs: 記録' })
  assert.equal(second.ok, true, second.message)
  assert.equal(onMain(path), 'A\nb\nc\nd\ne\nf\n')
})

test('重ねる元の記録はブランチごとで、別のブランチの古い版には当てない', () => {
  const path = 'todo/humans/2026-11-22-prod-check.md'
  // ほかの人が main のまとめに足した。手元のブランチはまだ取り込んでいない
  ok(git(['fetch', '-q', 'origin'], other), 'ほかの人の fetch')
  ok(git(['reset', '-q', '--hard', 'origin/main'], other), 'ほかの人を main にそろえる')
  write(other, path, appendProdCheck(readFileSync(join(other, path), 'utf8'), { heading: 'Z' }))
  ok(git(['commit', '-qam', 'docs: Z を足す'], other), 'ほかの人の commit')
  ok(git(['push', '-q', 'origin', 'main'], other), 'ほかの人の push')
  ok(git(['fetch', '-q', 'origin']), '取り直す')
  const latest = onMain(path)
  // feat/work で main の今の版を元として記録し、そのまままとめが古い版の別のブランチへ移って、古い版に足す
  rememberBase(repo, path, latest)
  ok(git(['switch', '-q', '-c', 'feat/old']), '別のブランチ')
  const stale = git(['show', `HEAD:${path}`])
  assert.equal(stale.status, 0, stale.stderr)
  assert.notEqual(stale.stdout, latest)
  write(repo, path, `${stale.stdout}\n追記\n`)
  // feat/work の記録を当てると、元 = main の版と見なして古い版で上書きし、Z が消える。
  // ブランチが違うので当てず、このブランチが main から分かれたときの版を元に重ねるので、Z も追記も残る
  const result = publishHumans({ root: repo, files: [path], message: 'docs: 記録' })
  assert.equal(result.ok, true, result.message)
  assert.match(onMain(path), /### \d+\. Z/, '別のブランチの記録を当てて、main で足された Z を消した')
  assert.match(onMain(path), /追記\n$/)
  ok(git(['checkout', '--', path]), '後片付け')
  ok(git(['switch', '-q', 'feat/work']), 'もとのブランチ')
})
