#!/usr/bin/env node
// ガードの判断の集計（npm run trace [日数]）。多く止められたルールは、方針か手順を見直す合図。
import { repoRoot } from './lib/proc.mjs'
import { summarizeTraces } from './lib/trace.mjs'

const days = Number(process.argv[2] ?? 7)
const counts = summarizeTraces(repoRoot(process.cwd()) ?? process.cwd(), days)
const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
if (rows.length === 0) console.log(`直近 ${days} 日のトレースはありません（.harness/trace/）`)
console.log(`直近 ${days} 日のガードの判断（イベント:判断:ルール）`)
for (const [key, count] of rows) console.log(`${String(count).padStart(5)}  ${key}`)
