import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCiIgnored, judgeCi, markNotStarted } from '../lib/release.mjs'
import { LIGHT_PATHS } from '../lib/verify-local.mjs'

const patterns = LIGHT_PATHS
const order = ['a', 'b', 'c', 'd'] // 古い順。前のものが後ろのものの祖先
const isAncestor = (x, y) => order.indexOf(x) <= order.indexOf(y)
const ok = (headSha) => ({ headSha, status: 'completed', conclusion: 'success' })

test('CI の対象外の変更（LIGHT_PATHS）を見分ける', () => {
  assert.ok(patterns.includes('docs/**'))
  assert.ok(patterns.includes('todo/**'))
  assert.ok(patterns.includes('**/*.md'))
  assert.ok(isCiIgnored('todo/humans/x.md', patterns))
  assert.ok(isCiIgnored('README.md', patterns))
  assert.ok(!isCiIgnored('web/src/app.tsx', patterns))
  assert.ok(!isCiIgnored('package.json', patterns))
})

test('main の先頭の CI が通っていれば反映してよい', () => {
  assert.equal(judgeCi({ mainSha: 'd', runs: [ok('d')], patterns, isAncestor, changedSince: () => [] }).ok, true)
})

test('main の先頭の CI が走っている途中なら、待たずに反映し、Deploy の verify に任せる', () => {
  const verdict = judgeCi({ mainSha: 'd', runs: [{ headSha: 'd', status: 'in_progress', conclusion: '' }], patterns, isAncestor, changedSince: () => [] })
  assert.equal(verdict.ok, true)
  assert.match(verdict.note, /Deploy の verify/)
})

test('main の先頭の CI が落ちていても止めず、知らせて Deploy の verify に任せる（2026-11-22 から）', () => {
  const verdict = judgeCi({ mainSha: 'd', runs: [{ headSha: 'd', status: 'completed', conclusion: 'failure' }], patterns, isAncestor, changedSince: () => [] })
  assert.equal(verdict.ok, true)
  assert.match(verdict.note, /通っていません（failure）.*Deploy の verify/)
})

test('CI が通ったあとが文書だけの変更なら反映してよい', () => {
  const verdict = judgeCi({ mainSha: 'd', runs: [ok('c')], patterns, isAncestor, changedSince: () => ['todo/humans/x.md', 'docs/a.md'] })
  assert.equal(verdict.ok, true)
})

test('CI が通ったあとに CI の対象の変更があっても反映し、確かめていない変更を伝える', () => {
  const verdict = judgeCi({ mainSha: 'd', runs: [ok('b')], patterns, isAncestor, changedSince: () => ['docs/a.md', 'web/src/x.ts'] })
  assert.equal(verdict.ok, true)
  assert.match(verdict.note, /web\/src\/x\.ts/)
})

test('通った CI より新しい CI が走っている途中なら、待たずに反映する', () => {
  const runs = [{ headSha: 'c', status: 'in_progress', conclusion: '' }, ok('b')]
  assert.equal(judgeCi({ mainSha: 'd', runs, patterns, isAncestor, changedSince: () => [] }).ok, true)
})

test('通った CI より新しい CI が落ちていても、取り消されていても止めない（main では CI が走らないので、上書きされない）', () => {
  const runs = [{ headSha: 'c', status: 'completed', conclusion: 'failure' }, ok('b')]
  assert.equal(judgeCi({ mainSha: 'd', runs, patterns, isAncestor, changedSince: () => [] }).ok, true)
  const cancelled = judgeCi({ mainSha: 'd', runs: [{ headSha: 'c', status: 'completed', conclusion: 'cancelled' }, ok('b')], patterns, isAncestor, changedSince: () => [] })
  assert.equal(cancelled.ok, true)
  assert.match(cancelled.note, /cancelled.*反映の条件にしない/)
})

test('CI が通った commit がなくても反映し、Deploy の verify に任せる', () => {
  assert.equal(judgeCi({ mainSha: 'd', runs: [], patterns, isAncestor, changedSince: () => [] }).ok, true)
})

test('CI が通った commit がなく、落ちた CI があっても止めない', () => {
  const runs = [{ headSha: 'c', status: 'completed', conclusion: 'failure' }]
  assert.equal(judgeCi({ mainSha: 'd', runs, patterns, isAncestor, changedSince: () => [] }).ok, true)
})

test('CI のジョブが始まらなかっただけ（支払い・利用上限）なら反映する。走って落ちた CI も止めない', () => {
  const notStarted = (sha) => ({ headSha: sha, status: 'completed', conclusion: 'failure', notStarted: true })
  const failed = (sha) => ({ headSha: sha, status: 'completed', conclusion: 'failure' })
  const head = judgeCi({ mainSha: 'd', runs: [notStarted('d')], patterns, isAncestor, changedSince: () => [] })
  assert.equal(head.ok, true)
  assert.match(head.note, /ジョブが始まりませんでした.*Deploy も始まらず/)
  // 先頭は文書だけの commit で CI がなく、その前の commit の CI が始まらなかった
  const older = judgeCi({ mainSha: 'd', runs: [notStarted('c'), ok('b')], patterns, isAncestor, changedSince: () => [] })
  assert.equal(older.ok, true)
  assert.match(older.note, /ジョブが始まりませんでした/)
  // 始まらなかった CI より前に、走って落ちた CI があれば止める
  assert.equal(judgeCi({ mainSha: 'd', runs: [notStarted('d'), failed('c'), ok('b')], patterns, isAncestor, changedSince: () => [] }).ok, true)
  assert.equal(judgeCi({ mainSha: 'd', runs: [notStarted('c'), failed('b'), ok('a')], patterns, isAncestor, changedSince: () => [] }).ok, true)
  assert.equal(judgeCi({ mainSha: 'd', runs: [failed('d')], patterns, isAncestor, changedSince: () => [] }).ok, true)
})

test('始まらなかった CI の印：すべてのジョブが始まらなかった CI にだけ付ける。数では打ち切らず、通った CI か走って落ちた CI で確かめるのをやめる', () => {
  const run = (headSha, conclusion, jobs = []) => ({ headSha, status: 'completed', conclusion, jobs })
  const ports = { jobsOf: (item) => item.jobs, notStarted: (job) => job === 'skipped' }
  const marks = (runs) => markNotStarted(runs, ports).map((item) => Boolean(item.notStarted))
  // 始まらなかった CI が 5 つ続いても、全部に付く（Actions が止まっているあいだ、merge のたびに増える）
  const five = ['f', 'e', 'd', 'c', 'b'].map((sha) => run(sha, 'failure', ['skipped']))
  assert.deepEqual(marks([...five, run('a', 'success')]), [true, true, true, true, true, false])
  assert.equal(judgeCi({ mainSha: 'f', runs: markNotStarted([...five, run('a', 'success')], ports), patterns, isAncestor: () => true, changedSince: () => [] }).ok, true)
  // 一部のジョブだけ始まらなかった、ジョブがない、は付けない
  assert.deepEqual(marks([run('c', 'failure', ['skipped', 'ran']), run('b', 'failure', ['skipped'])]), [false, false])
  assert.deepEqual(marks([run('c', 'failure', [])]), [false])
  // 通った CI より古いものは確かめない
  let asked = 0
  const counting = { ...ports, jobsOf: (item) => { asked += 1; return item.jobs } }
  assert.deepEqual(markNotStarted([run('d', 'failure', ['skipped']), run('c', 'success'), run('b', 'failure', ['skipped'])], counting).map((item) => Boolean(item.notStarted)), [true, false, false])
  assert.equal(asked, 1)
  // 読めなかった（例外）ときは付けない。まだ走っている CI はそのまま
  assert.deepEqual(markNotStarted([run('b', 'failure')], { jobsOf: () => { throw new Error('gh') }, notStarted: () => true }).map((item) => Boolean(item.notStarted)), [false])
  const running = [{ headSha: 'b', status: 'in_progress', conclusion: '' }]
  assert.deepEqual(markNotStarted(running, { jobsOf: () => ['skipped'], notStarted: () => true }), running)
})
