#!/usr/bin/env node
// 手元で、CI の 2 つのジョブと同じ確認を走らせ、通ったら PR に記録する（npm run verify:local）。
//   harness：ハーネスのテスト（npm run test:harness）と、機械のチェック（check.mjs --base origin/main）
//   verify ：npm run verify（lint、build、テスト、Emulator の通し確認）。CI が走らせない変更（文書だけなど）では走らせない
// Emulator は、いつもポートを 10000（ふさがっていれば 20000）ずらして走る。既定のポートはこの Mac のランナーの Deploy に空けておく（1 台の Mac で複数の AI が動くため）。
// 記録は、commit の番号つきの目印（lib/verify-local.mjs の VERIFY_MARKER）を入れた PR のコメント。
// CI のジョブが始まらなかったときだけ、merge のガードがこの記録を CI の代わりにする（lib/command-guard.mjs の mergeProblems）。
//
// 使い方：npm run verify:local [-- --no-post]
//   --no-post  PR にコメントしない（確かめるだけ）
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LOCAL_OFFSETS, altFirebaseConfig, altVerifyCommand, emulatorPorts, heavyNeeded, pickLocalOffset, verifyComment } from './lib/verify-local.mjs'
import { currentBranch, gh, git, gitOut, repoRoot } from './lib/proc.mjs'

const root = repoRoot()
const post = !process.argv.includes('--no-post')

function die(message, hints = []) {
  console.error(`\n手元の確認：${message}`)
  for (const hint of hints) console.error(`  - ${hint}`)
  process.exit(1)
}

/** そのアドレスとポートで待ち受けられるか */
function canListen(port, host) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

/**
 * そのポートが空いているか。Emulator が待ち受ける 0.0.0.0 と 127.0.0.1 の両方で確かめる。
 * Windows では、ほかの Emulator が 127.0.0.1 だけで待ち受けていても 0.0.0.0 では待ち受けられてしまい、空いていると見誤るため
 */
const portFree = async (port) => (await canListen(port, '127.0.0.1')) && (await canListen(port, '0.0.0.0'))

const allFree = async (ports) => (await Promise.all(ports.map(portFree))).every(Boolean)

// 失敗は throw する（呼んだ側の finally で一時ファイルを片付けてから、いちばん外で止める）
class StepFailed extends Error {}

/**
 * 命令を走らせるシェル。package.json の verify は「AI_PASSPHRASE=… firebase …」のような sh の書き方なので、
 * Windows では cmd.exe でなく Git for Windows の bash で走らせる（PATH の bash は WSL のものを指すことがあるので使わない）。
 * 見つからなければ今までどおり既定のシェル
 */
function commandShell() {
  if (process.platform !== 'win32') return true
  const execPath = gitOut(['--exec-path'])
  const bash = execPath && resolve(execPath, '..', '..', '..', 'bin', 'bash.exe')
  return bash && existsSync(bash) ? bash : true
}

const shell = commandShell()

function run(name, command, env = {}) {
  console.log(`\n── ${name}：${command}`)
  const started = Date.now()
  const result = spawnSync(command, { cwd: root, shell, stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.status !== 0) throw new StepFailed(`${name} が通りませんでした（終了コード ${result.status ?? '不明'}）`)
  return Math.round((Date.now() - started) / 1000)
}

process.on('uncaughtException', (error) => {
  if (error instanceof StepFailed) die(error.message, ['上の出力の失敗を直して commit し、もう一度 `npm run verify:local` を実行します'])
  throw error
})

if ((gitOut(['status', '--porcelain'], { cwd: root }) ?? '').trim()) {
  die('commit していない変更があります', ['記録は commit に結び付くので、commit してから実行します'])
}
const sha = gitOut(['rev-parse', 'HEAD'], { cwd: root })?.trim()
if (!sha) die('今の commit が分かりません')
git(['fetch', 'origin', 'main'], { cwd: root })
const changed = (gitOut(['diff', '--name-only', 'origin/main...HEAD'], { cwd: root }) ?? '').split('\n').filter(Boolean)

const steps = []
// ハーネスのテストは、一時リポジトリで git を動かす。CI（harness.yml）と同じく、git の全体の設定を一時ファイルに向けて走らせる
// （持ち主の ~/.gitconfig の設定で結果が変わらないように。テストが ~/.gitconfig を書き換えないようにも）
const gitHome = mkdtempSync(join(tmpdir(), 'harness-verify-'))
const gitConfig = join(gitHome, 'gitconfig')
writeFileSync(gitConfig, '[user]\n\tname = harness-ci\n\temail = harness-ci@example.invalid\n')
try {
  steps.push({ name: 'ハーネスのテスト（npm run test:harness）', detail: `通過（${run('ハーネスのテスト', 'npm run test:harness', { GIT_CONFIG_GLOBAL: gitConfig })} 秒）` })
} finally {
  rmSync(gitHome, { recursive: true, force: true })
}
steps.push({ name: '機械のチェック（check.mjs --base origin/main）', detail: `通過（${run('機械のチェック', 'node scripts/harness/check.mjs --base origin/main')} 秒）` })

if (!heavyNeeded(changed)) {
  steps.push({ name: 'npm run verify', detail: '走らせていない（CI と同じく、文書やハーネスの設定だけの変更では走らせない）' })
} else {
  const firebase = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
  const verify = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.verify
  // 既定のポートはランナーの Deploy に空けておき、手元の確認はいつもずらしたポートで走る（lib/verify-local.mjs の LOCAL_OFFSETS）
  const offset = await pickLocalOffset((candidate) => allFree(emulatorPorts(firebase, candidate)))
  if (offset === null) {
    die(`Emulator のポートが、${LOCAL_OFFSETS.map((value) => `${value} ずらしたもの`).join('も')}も使われています`, ['ほかの手元の確認が終わるのを待つか、npm run dev:alt を止めてから、もう一度実行します'])
  }
  const command = altVerifyCommand(verify)
  if (!command) die('package.json の verify の形が変わっていて、ポートをずらせません', ['scripts/harness/lib/verify-local.mjs の altVerifyCommand を合わせます'])
  const altFile = join(root, 'firebase.alt.json')
  writeFileSync(altFile, `${JSON.stringify(altFirebaseConfig(firebase, offset), null, 2)}\n`)
  try {
    const seconds = run(`verify（ポートを ${offset} ずらす）`, command, { EMULATOR_PORT_OFFSET: String(offset) })
    steps.push({ name: 'npm run verify', detail: `通過（${seconds} 秒。Emulator のポートを ${offset} ずらした。既定のポートはランナーに空けておく）` })
  } finally {
    rmSync(altFile, { force: true })
  }
}

// 走らせているあいだに commit が増えていたら、記録しない（確かめたものと違う中身になるため）
if (gitOut(['rev-parse', 'HEAD'], { cwd: root })?.trim() !== sha || (gitOut(['status', '--porcelain'], { cwd: root }) ?? '').trim()) {
  die('確かめているあいだに、commit かファイルが変わりました', ['もう一度 `npm run verify:local` を実行します'])
}

console.log(`\n手元の確認が通りました（commit ${sha.slice(0, 7)}）`)
if (!post) process.exit(0)

const branch = currentBranch(root)
const pushed = gitOut(['rev-parse', `origin/${branch}`], { cwd: root })?.trim()
if (pushed !== sha) die('この commit は、まだ push されていません', [`\`git push origin ${branch}\` のあと、もう一度実行します（記録は、PR の先頭の commit に付けます）`])
const bodyFile = join(root, '.harness', 'verify-local.md')
spawnSync('mkdir', ['-p', join(root, '.harness')])
writeFileSync(bodyFile, `${verifyComment({ sha, steps, where: `${hostname()} の作業ツリー` })}\n`)
const commented = gh(['pr', 'comment', branch, '--body-file', bodyFile], { cwd: root })
rmSync(bodyFile, { force: true })
if (!commented.ok) die('PR に記録を残せませんでした', ['PR があるか（`npm run work -- declare`）、gh が使えるかを確かめます'])
console.log(`PR に記録を残しました：${commented.stdout.trim()}`)
