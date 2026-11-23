#!/usr/bin/env node
// GitHub の出来事を Discord に知らせる。GitHub Actions（.github/workflows/notify.yml）が動かす。文面は lib/discord.mjs。
//   node scripts/harness/notify-discord.mjs work --before <sha> --after <sha> [--dry-run]
//       main への push の前後で作業宣言（docs/work/）を比べ、#着手 と #完了 に流す
//   node scripts/harness/notify-discord.mjs run [--dry-run]
//       workflow_run の結果（GITHUB_EVENT_PATH）から、#本番反映 に流す（反映の成功と失敗、main の CI などの失敗）
// #人間待ち は kanban-sync.mjs が流す（まだ送っていない open な人間待ちを送り、決まったら同じメッセージを対応中・完了に書き換える）。
// Webhook の secret が未登録のチャンネルには送らず、そう表示して終わる（失敗にはしない）。
import { readFileSync } from 'node:fs'
import { blockedBy } from './lib/board.mjs'
import { CHANNELS, ledgerEvent, messageText, postDiscord, prNumbersFromSubjects, renderDone, renderRun, renderStart, webhookFor } from './lib/discord.mjs'
import { parseLedger } from './lib/ledger.mjs'
import { loadMembers } from './lib/members.mjs'
import { gh as runGh, gitOut, repoRoot } from './lib/proc.mjs'
import { collectHumanTodos } from './lib/work-index.mjs'

const root = repoRoot(process.cwd()) ?? process.cwd()
const [mode, ...rest] = process.argv.slice(2)
const option = (name) => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}
const dryRun = rest.includes('--dry-run')
const gh = (args) => runGh(args, { cwd: root, timeout: 30_000 })
const ghJson = (args) => {
  const result = gh(args)
  return result.ok ? JSON.parse(result.stdout || 'null') : undefined
}
const repo = process.env.GITHUB_REPOSITORY || ghJson(['repo', 'view', '--json', 'nameWithOwner'])?.nameWithOwner
const repoUrl = `https://github.com/${repo}`
const members = loadMembers(root)

async function send(channel, message) {
  const url = webhookFor(channel)
  console.log(`--- #${CHANNELS[channel].name}${dryRun ? '（試し）' : ''}${url ? '' : '（Webhook が未登録なので送りません）'}\n${messageText(message)}`)
  if (dryRun || !url) return
  try {
    await postDiscord(url, message)
  } catch (error) {
    // 通知の失敗で、ほかの通知や Actions を止めない
    console.log(`注意：#${CHANNELS[channel].name} に送れませんでした：${error.message}`)
  }
}

const isLedger = (path) => /^docs\/work\/[^/]+\.md$/.test(path) && !/\/(README|_template)\.md$/.test(path)
const show = (ref, path) => gitOut(['show', `${ref}:${path}`], { cwd: root })

/** PR に画像か動画が添えてあるか（本文かコメントに、GitHub に上げたファイルや画像の記法がある） */
function hasMedia(number) {
  const pr = ghJson(['pr', 'view', String(number), '--json', 'body,comments'])
  const text = [pr?.body ?? '', ...(pr?.comments ?? []).map((comment) => comment.body ?? '')].join('\n')
  return /user-attachments|!\[[^\]]*\]\(|\.(png|jpe?g|gif|mp4|mov|webm)\b/i.test(text)
}

async function work() {
  const before = option('before')
  const after = option('after') ?? 'HEAD'
  if (!before || /^0+$/.test(before)) {
    console.log('前の commit がない push なので、何もしません')
    return
  }
  const changed = (gitOut(['diff', '--name-only', before, after, '--', 'docs/work'], { cwd: root }) ?? '').split('\n').filter(isLedger)
  const todos = collectHumanTodos(root, { ref: after })
  const blocked = blockedBy(todos)
  for (const path of changed) {
    const next = show(after, path)
    if (!next) continue
    const prev = show(before, path)
    const ledger = parseLedger(next, path)
    const event = ledgerEvent(prev ? parseLedger(prev, path) : undefined, ledger)
    if (event === 'start') {
      const pr = ghJson(['pr', 'list', '--head', ledger.branch, '--state', 'open', '--json', 'number,url', '--limit', '1'])?.[0]
      await send('start', renderStart(ledger, { repoUrl, pr, members }))
    } else if (event === 'done') {
      const prs = ghJson(['pr', 'list', '--head', ledger.branch, '--state', 'merged', '--json', 'number,url,title', '--limit', '10']) ?? []
      const pr = prs.find((item) => !/^作業宣言[:：]/.test(item.title ?? ''))
      const waiting = ledger.issue ? (blocked.get(Number(ledger.issue)) ?? []) : []
      await send('done', renderDone(ledger, { pr, waiting, hasMedia: pr ? hasMedia(pr.number) : false, members }))
    }
  }
}

/** 前に成功した反映から今回までに、main から入った PR（merge の commit の題から番号を拾う） */
function deployedPrs(run) {
  const runs = ghJson(['run', 'list', '--workflow', 'deploy.yml', '--status', 'success', '--limit', '5', '--json', 'databaseId,headSha']) ?? []
  const previous = runs.find((item) => item.databaseId !== run.id && item.headSha !== run.head_sha)
  if (!previous) return []
  const subjects = (gitOut(['log', '--format=%s', `${previous.headSha}..${run.head_sha}`], { cwd: root }) ?? '').split('\n')
  const numbers = prNumbersFromSubjects(subjects)
  return numbers
    .map((number) => ghJson(['pr', 'view', number, '--json', 'number,title']))
    .filter((pr) => pr && !/^作業宣言[:：]/.test(pr.title ?? ''))
}

async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const workflowRun = event.workflow_run
  if (!workflowRun) return console.log('workflow_run の出来事ではないので、何もしません')
  const prs = workflowRun.name === 'Deploy' && workflowRun.conclusion === 'success' ? deployedPrs(workflowRun) : []
  const message = renderRun(workflowRun, { prs })
  if (message) await send('release', message)
  else console.log(`${workflowRun.name}（${workflowRun.conclusion}、${workflowRun.head_branch}）は流しません`)
}

const modes = { work, run }
if (!modes[mode]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(mode ? 1 : 0)
}
await modes[mode]()
