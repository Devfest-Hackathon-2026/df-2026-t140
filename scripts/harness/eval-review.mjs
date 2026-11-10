#!/usr/bin/env node
// レビュー役（LLM の判断）の評価。evals/review/cases/ の各ケースを reviewer エージェントにレビューさせ、採点する。
//   npm run eval:review [-- --case <名前>] [--budget <1 件の上限ドル>]
// 費用がかかる（1 件ごとに上限を付ける）。プロンプト、評価軸、reviewer の手順を変えたら流し、前の結果と比べる。
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractReviewJson, gradeReview } from './lib/eval-grade.mjs'
import { repoRoot } from './lib/proc.mjs'

const root = repoRoot(process.cwd()) ?? process.cwd()
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const only = option('case')
const budget = String(Number(option('budget', '1.5')) || 1.5) // 数だけを受け付ける
const casesDir = join(root, 'evals', 'review', 'cases')
const names = readdirSync(casesDir).filter((name) => !only || name === only)

// 無応答 < 1 件の上限 < 全体。1 件は手数と費用と時間で止める
const TURNS = '30'
const TIMEOUT_MS = 15 * 60_000

const results = []
for (const name of names) {
  const pack = join(casesDir, name, 'pack.md').replaceAll('\\', '/')
  const expected = JSON.parse(readFileSync(join(casesDir, name, 'expected.json'), 'utf8'))
  const prompt = `docs/process/reviewer.md の手順で、レビューパック ${pack} をレビューしてください。評価用のケースなので、PR の head のチェックアウトはありません。差分と、リポジトリにある正本と評価軸だけで判断し、reviewer.md の形の JSON を返してください。`
  const started = Date.now()
  // Windows の claude は .cmd なのでシェルを通す。引数は決まった値と数だけ（プロンプトは標準入力で渡す）
  const command = `claude -p --agent reviewer --output-format json --max-turns ${TURNS} --max-budget-usd ${budget} --allowedTools Read,Grep,Glob`
  const run = spawnSync(command, {
    cwd: root,
    input: prompt,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    shell: true,
    env: { ...process.env, HARNESS_OFFLINE: '1' },
    maxBuffer: 64 * 1024 * 1024,
  })
  let output = {}
  try {
    output = JSON.parse(run.stdout)
  } catch {
    output = { result: run.stdout, error: run.stderr }
  }
  const review = extractReviewJson(output.result ?? '')
  const grade = gradeReview(review, expected)
  const record = { name, ...grade, verdict: review?.verdict, cost: output.total_cost_usd, turns: output.num_turns, seconds: Math.round((Date.now() - started) / 1000), review }
  results.push(record)
  console.log(`${grade.pass ? 'OK  ' : 'NG  '} ${name}（結論 ${review?.verdict ?? '-'}、見つけた ${grade.found}/${grade.needed}、${record.seconds} 秒、$${output.total_cost_usd?.toFixed?.(2) ?? '?'}）${grade.problems.length ? `\n      ${grade.problems.join('\n      ')}` : ''}`)
}

const passed = results.filter((result) => result.pass).length
console.log(`\n${passed}/${results.length} 件が期待どおり`)
const outDir = join(root, '.harness', 'evals')
mkdirSync(outDir, { recursive: true })
const file = join(outDir, `review-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
console.log(`結果：${file.replaceAll('\\', '/')}`)
