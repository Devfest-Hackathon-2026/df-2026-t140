#!/usr/bin/env node
// 機械で確かめること（docs/process/review-rubric.md の「機械」の項目）をまとめて見る。
//   npm run check:harness                     作業ツリーとこのブランチ（main との差も見る）
//   node scripts/harness/check.mjs --quick    層、依存、文書のリンクだけ（npm run lint から呼ぶ）
//   CI：node scripts/harness/check.mjs --base origin/main --branch "$GITHUB_HEAD_REF"
import { appendFileSync } from 'node:fs'
import { formatResults, hasFailure, refSource, runChecks, treeSource } from './lib/checks.mjs'
import { currentBranch, gitOut, repoRoot } from './lib/proc.mjs'

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const root = repoRoot(process.cwd()) ?? process.cwd()
// --code：コードのチェック（層、依存）だけ。npm run lint（verify、デプロイの前）から呼ぶので、文書のリンク切れでデプロイを止めない
const code = args.includes('--code')
const quick = code || args.includes('--quick')
const ref = option('ref')
const branch = option('branch') || process.env.GITHUB_HEAD_REF || currentBranch(root)
const base = quick ? undefined : option('base') ?? (gitOut(['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: root }) ? 'origin/main' : undefined)

const source = ref ? refSource(ref, root) : treeSource(root)
const results = runChecks({ source, cwd: root, branch, base, head: ref ?? 'HEAD', quick }).filter(
  (result) => !code || ['arch', 'exceptions', 'deps'].includes(result.id),
)
const report = formatResults(results)
console.log(`ハーネスのチェック（${source.label}${branch ? `、${branch}` : ''}${base ? `、${base} との差` : ''}）\n${report}`)

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((result) => `| ${{ ok: '✅', fail: '❌', warn: '⚠️', info: 'ℹ️', skip: '➖' }[result.status]} | ${result.title} | ${result.details.slice(0, 10).join('<br>').replaceAll('|', '\\|')} |`)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ハーネスのチェック\n\n| | 項目 | 詳しく |\n| --- | --- | --- |\n${rows.join('\n')}\n`)
}
if (hasFailure(results)) {
  console.error('\nNG を直してください。直し方は各行と docs/process/work.md にあります')
  process.exit(1)
}
