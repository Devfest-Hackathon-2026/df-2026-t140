#!/usr/bin/env node
// main の今の中身を deploy へ反映する（本番へ出す）。人だけが使う（AI はガードの no-deploy で止まる）。
//   npm run release            CI を確かめ、反映する前に確認する
//   npm run release -- --yes   確認を飛ばす
// 手元のブランチと作業中のファイルには触れない。deploy の先頭と main を親にした merge の commit を、
// main と同じ中身で作って push する（deploy にはこれまでの merge の commit があり、早送りの push ができないため）。
// push すると GitHub Actions の Deploy が verify、本番へのデプロイ、本番の確認テストを行う。
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { DEPLOY_BRANCH } from './lib/conventions.mjs'
import { gh, git, gitOut, repoRoot, TIMEOUT_MS } from './lib/proc.mjs'
import { judgeCi, markNotStarted } from './lib/release.mjs'
import { jobNotStarted, LIGHT_PATHS } from './lib/verify-local.mjs'

const root = repoRoot(process.cwd()) ?? process.cwd()
const args = process.argv.slice(2)

function die(message) {
  console.error(`[release] ${message}`)
  process.exit(1)
}
const log = (message) => console.log(`[release] ${message}`)

const fetched = git(['fetch', 'origin', 'main', DEPLOY_BRANCH], { cwd: root, timeout: 60_000 })
if (!fetched.ok) die(`origin から main と ${DEPLOY_BRANCH} を取れませんでした。${fetched.stderr.trim()}`)

const mainSha = gitOut(['rev-parse', 'origin/main'], { cwd: root })
const deploySha = gitOut(['rev-parse', `origin/${DEPLOY_BRANCH}`], { cwd: root })
if (!mainSha || !deploySha) die(`origin/main か origin/${DEPLOY_BRANCH} が見つかりません`)

const isAncestor = (a, b) => git(['merge-base', '--is-ancestor', a, b], { cwd: root }).ok
const sameTree = gitOut(['rev-parse', 'origin/main^{tree}'], { cwd: root }) === gitOut(['rev-parse', `origin/${DEPLOY_BRANCH}^{tree}`], { cwd: root })
if (isAncestor(mainSha, deploySha) || sameTree) {
  log(`${DEPLOY_BRANCH} はもう main（${mainSha.slice(0, 7)}）と同じです。出し直すだけなら、Actions の Deploy を Run workflow で動かします`)
  process.exit(0)
}

// main の CI を確かめる
const listed = gh(['run', 'list', '--workflow', 'ci.yml', '--branch', 'main', '--event', 'push', '--limit', '30', '--json', 'headSha,status,conclusion,databaseId'], { cwd: root, timeout: 30_000 })
if (!listed.ok) die(`CI の結果を取れませんでした（gh にログインしているかを確かめます）。${listed.stderr.trim()}`)
// 落ちた CI は、ジョブが始まらなかっただけ（GitHub が、支払い・利用上限などでジョブを始めなかった）かを、ジョブの注記で確かめる
// （lib/release.mjs の markNotStarted。読めなければ、ふつうの失敗として扱う＝止める側に倒す）
const api = (path) => JSON.parse(gh(['api', `repos/{owner}/{repo}/${path}`], { cwd: root, timeout: 15_000 }).stdout)
const runs = markNotStarted(JSON.parse(listed.stdout), {
  jobsOf: (run) => api(`actions/runs/${run.databaseId}/jobs`).jobs,
  notStarted: (job) => jobNotStarted(api(`check-runs/${job.id}/annotations`)),
})
// CI の対象外の変更（文書など）。手元の確認と同じ決め（ci.yml は手で走らせるときだけになったので、paths-ignore は持たない）
const patterns = LIGHT_PATHS
const changedSince = (sha) => (gitOut(['diff', '--name-only', sha, mainSha], { cwd: root }) ?? '').split('\n').filter(Boolean)
const verdict = judgeCi({ mainSha, runs, patterns, isAncestor, changedSince })
if (!verdict.ok) die(verdict.reason)
log(verdict.note)

const commits = gitOut(['log', '--no-merges', '--format=  %h %s', `${deploySha}..${mainSha}`], { cwd: root }) ?? ''
const count = commits.split('\n').filter(Boolean).length
log(`本番に出る commit（${count} 件）：`)
console.log(commits.split('\n').slice(0, 30).join('\n') + (count > 30 ? `\n  ほか ${count - 30} 件` : ''))

if (!args.includes('--yes')) {
  if (!process.stdin.isTTY) die('確認できない環境です。反映するなら `npm run release -- --yes` で動かします')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`main（${mainSha.slice(0, 7)}）を ${DEPLOY_BRANCH} へ反映して、本番に出しますか？ [y/N] `)).trim().toLowerCase()
  rl.close()
  if (!['y', 'yes'].includes(answer)) die('やめました')
}

// main と同じ中身の merge の commit を作る（作業ツリーとブランチには触れない）
const message = `Merge main (${mainSha.slice(0, 7)}) into ${DEPLOY_BRANCH}`
const made = git(['commit-tree', 'origin/main^{tree}', '-p', deploySha, '-p', mainSha, '-m', message], { cwd: root, timeout: TIMEOUT_MS.local })
if (!made.ok) die(`merge の commit を作れませんでした。${made.stderr.trim()}`)
const releaseSha = made.stdout.trim()

// push は pre-push のフックの出力も見えるように、そのまま端末につなぐ
const pushed = spawnSync('git', ['push', 'origin', `${releaseSha}:refs/heads/${DEPLOY_BRANCH}`], { cwd: root, stdio: 'inherit', timeout: 600_000 })
if (pushed.status !== 0) die(`${DEPLOY_BRANCH} への push に失敗しました。ほかの人が先に反映していたら、もう一度 \`npm run release\` を動かします`)

git(['fetch', 'origin', DEPLOY_BRANCH], { cwd: root, timeout: 60_000 })
log(`${DEPLOY_BRANCH} へ反映しました（${releaseSha.slice(0, 7)}）。GitHub Actions の Deploy が、verify、本番へのデプロイ、本番の確認テストを行います`)
const url = gitOut(['remote', 'get-url', 'origin'], { cwd: root })?.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
if (url) log(`進み具合：${url}/actions/workflows/deploy.yml`)
