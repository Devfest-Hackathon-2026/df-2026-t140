// 手元の確認（npm run verify:local）の決めと、CI が始まらなかったときの merge の条件を確かめる
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { latestChecks, mergeProblems } from '../lib/command-guard.mjs'
import {
  ALT_OFFSET,
  LOCAL_OFFSETS,
  pickLocalOffset,
  altFirebaseConfig,
  altVerifyCommand,
  emulatorPorts,
  heavyNeeded,
  jobNotStarted,
  LIGHT_PATHS,
  VERIFY_MARKER,
  verifyComment,
  verifyMarker,
} from '../lib/verify-local.mjs'

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const SHA = 'a'.repeat(40)
const OLD = 'b'.repeat(40)
const ready = { base: 'main', files: ['web/src/app/App.tsx'], isDraft: false, mergeable: 'MERGEABLE', review: { verdict: 'APPROVE', sha: SHA }, headSha: SHA }
const notStarted = (name) => ({ name, state: 'FAILURE', notStarted: true })

test('merge の条件は CI ではなく手元の確認の記録：先頭の commit の記録があれば、CI が順番待ち・始まらなかった・ないときも merge できる（2026-11-22）', () => {
  const verified = { localVerify: { sha: SHA } }
  for (const checks of [[], [{ name: 'verify', state: 'PENDING' }], [notStarted('verify'), notStarted('harness')], [{ name: 'harness', state: 'SUCCESS' }]]) {
    assert.deepEqual(mergeProblems({ ...ready, ...verified, checks }), [], JSON.stringify(checks))
  }
  // 記録がない、前の commit のものなら止まる（CI が通っていても）
  assert.match(mergeProblems({ ...ready, checks: [{ name: 'verify', state: 'SUCCESS' }] })[0], /手元の確認の記録がない.*verify:local/)
  assert.match(mergeProblems({ ...ready, checks: [], localVerify: { sha: OLD } })[0], /前の commit/)
})

test('CI を手で走らせて落ちた結果があれば、手元の記録があっても止まる', () => {
  const verified = { localVerify: { sha: SHA } }
  assert.match(mergeProblems({ ...ready, ...verified, checks: [{ name: 'verify', state: 'FAILURE' }] })[0], /CI が走って落ちた（verify）/)
  // 始まらなかっただけ（支払い・利用上限）のものは、落ちたとみなさない
  assert.deepEqual(mergeProblems({ ...ready, ...verified, checks: [notStarted('verify')] }), [])
})

test('手元の記録は、レビューやほかの条件の代わりにはならない', () => {
  const verified = { localVerify: { sha: SHA } }
  assert.match(mergeProblems({ ...ready, ...verified, checks: [], review: undefined })[0], /レビューの承認がない/)
  assert.match(mergeProblems({ ...ready, ...verified, checks: [], labels: ['作業中'] })[0], /作業中/)
})

test('ジョブが始まらなかったかは、GitHub の注記で決める。チェックの一覧には、注記を引くためのジョブのページを残す', () => {
  const billing = "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings"
  assert.equal(jobNotStarted([{ message: billing }]), true)
  assert.equal(jobNotStarted([{ message: 'Process completed with exit code 1.' }]), false)
  assert.equal(jobNotStarted([]), false)
  assert.equal(jobNotStarted(undefined), false)
  const url = 'https://github.com/o/r/actions/runs/1/job/22'
  assert.deepEqual(latestChecks([{ name: 'verify', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-11-21T06:39:19Z', detailsUrl: url }]), [{ name: 'verify', state: 'FAILURE', url }])
})

test('記録の目印：commit の番号（40 けた）つき。コメントの最後に入る', () => {
  assert.equal(verifyMarker(SHA).match(VERIFY_MARKER)[1], SHA)
  assert.equal(VERIFY_MARKER.test('<!-- harness-verify result=pass sha=abc1234 -->'), false)
  assert.equal(VERIFY_MARKER.test(`<!-- harness-verify result=fail sha=${SHA} -->`), false)
  const body = verifyComment({ sha: SHA, steps: [{ name: 'npm run verify', detail: '通過（200 秒）' }], where: '手元' })
  assert.equal(body.match(VERIFY_MARKER)[1], SHA)
  assert.match(body, /npm run verify：通過（200 秒）/)
})

test('Emulator の確認が要る変更の決め（LIGHT_PATHS が正本）', () => {
  assert.equal(heavyNeeded(['docs/product/proposal.md', 'todo/humans/a.md', 'README.md', '.claude/skills/x/SKILL.md', 'harness.config.json']), false)
  assert.equal(heavyNeeded(['docs/product/proposal.md', 'web/src/app/App.tsx']), true)
  assert.equal(heavyNeeded(['scripts/harness/work.mjs']), true)
  assert.equal(heavyNeeded([]), false)
  // 文書、todo、AI の設定は重い確認をしない
  for (const path of ['docs/**', 'todo/**', '**/*.md']) assert.ok(LIGHT_PATHS.includes(path))
})

test('ポートをずらす：firebase.json のポートと既定のポートを全部ずらし、verify の命令にずらした設定を読ませる', () => {
  const firebase = JSON.parse(read('firebase.json'))
  const alt = altFirebaseConfig(firebase)
  assert.equal(alt.emulators.firestore.port, firebase.emulators.firestore.port + ALT_OFFSET)
  assert.equal(alt.emulators.firestore.websocketPort, 9150 + ALT_OFFSET)
  assert.equal(alt.emulators.hub.port, 4400 + ALT_OFFSET)
  assert.equal(alt.hosting.public, firebase.hosting.public)
  assert.ok(emulatorPorts(firebase).includes(8080) && emulatorPorts(firebase).includes(4400))
  assert.deepEqual(emulatorPorts(firebase, ALT_OFFSET), emulatorPorts(firebase).map((port) => port + ALT_OFFSET))
  // package.json の verify の命令が、ずらせる形のままであること
  const command = altVerifyCommand(JSON.parse(read('package.json')).scripts.verify)
  assert.match(command, /firebase emulators:exec --config firebase\.alt\.json --project /)
  assert.equal(altVerifyCommand('npm test'), null)
})

test('手元の確認のずれ：既定のポートは使わず、10000、ふさがっていれば 20000、どちらもふさがっていれば null', async () => {
  assert.deepEqual(LOCAL_OFFSETS, [10000, 20000])
  assert.ok(!LOCAL_OFFSETS.includes(0), '既定のポートはランナーの Deploy に空けておく')
  assert.equal(await pickLocalOffset(async () => true), 10000)
  assert.equal(await pickLocalOffset(async (offset) => offset !== 10000), 20000)
  assert.equal(await pickLocalOffset(async () => false), null)
  // 20000 ずらしても、ポートは 65535 を超えない
  const firebase = JSON.parse(read('firebase.json'))
  assert.ok(emulatorPorts(firebase, 20000).every((port) => port < 65536))
  assert.equal(altFirebaseConfig(firebase, 20000).emulators.hub.port, 24400)
})
