#!/usr/bin/env node
// 画面の日本語の文言を、同梱の yomiyasu の lint で点検する。知らせるだけで、いつも終了コード 0 で終わる。
//
//   npm run copy:check                 web/src のすべての文言を点検する
//   npm run copy:check -- --changed    main から変えた・足した文言だけ（まだ commit していない変更も含む）
//   npm run copy:check -- --list       lint にかけず、文言と場所を出すだけ（yomiyasu に渡す下書きに使う）
//
// 決まりと使い方：docs/ui/README.md「画面の文言」。lint は Python 3.8 以上が要る。なければ飛ばす。
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COPY_ROOT, extractCopy, isCopyFile } from './harness/lib/ui-copy.mjs'
import { gitOut, repoRoot, run } from './harness/lib/proc.mjs'

const root = repoRoot(fileURLToPath(new URL('.', import.meta.url))) ?? process.cwd()
const LINT = '.agents/skills/yomiyasu/scripts/yomiyasu_lint.py'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
if (has('--help') || has('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const unknown = args.filter((arg) => !['--changed', '--list'].includes(arg))
if (unknown.length > 0) {
  console.error(`知らないオプションです：${unknown.join(' ')}（使えるのは --changed、--list）`)
  process.exit(2)
}

const toPosix = (path) => path.replaceAll('\\', '/')

function allFiles(dir) {
  const out = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...allFiles(rel))
    else if (isCopyFile(rel)) out.push(rel)
  }
  return out
}

const lines = (text) => (text ?? '').split('\n').map((line) => line.trim()).filter(Boolean)

// 文言を集める：[{ file, line, text }]
function collect() {
  if (!has('--changed')) {
    return { items: allFiles(COPY_ROOT).flatMap((file) => extractCopy(readFileSync(join(root, file), 'utf8')).map((item) => ({ file, ...item }))), base: undefined }
  }
  const base = gitOut(['merge-base', 'origin/main', 'HEAD'], { cwd: root }) ?? gitOut(['merge-base', 'main', 'HEAD'], { cwd: root })
  if (!base) {
    console.error('main との分かれ目が見つかりません。git fetch してから、もう一度実行します')
    process.exit(0)
  }
  const files = new Set([
    ...lines(gitOut(['diff', '--name-only', '--diff-filter=AMR', base, '--', COPY_ROOT], { cwd: root })),
    ...lines(gitOut(['ls-files', '--others', '--exclude-standard', '--', COPY_ROOT], { cwd: root })),
  ])
  const items = []
  for (const file of [...files].map(toPosix).filter(isCopyFile)) {
    if (!existsSync(join(root, file))) continue
    const before = new Set(extractCopy(gitOut(['show', `${base}:${file}`], { cwd: root }) ?? '').map((item) => item.text))
    for (const item of extractCopy(readFileSync(join(root, file), 'utf8'))) if (!before.has(item.text)) items.push({ file, ...item })
  }
  return { items, base }
}

// 同じ文言は 1 つにまとめ、出てくる場所をすべて持つ
function group(items) {
  const byText = new Map()
  for (const item of items) {
    const entry = byText.get(item.text) ?? { text: item.text, places: [] }
    entry.places.push(`${item.file}:${item.line}`)
    byText.set(item.text, entry)
  }
  return [...byText.values()]
}

function findPython() {
  for (const [cmd, ...pre] of [['py', '-3'], ['python3'], ['python']]) {
    const result = run(cmd, [...pre, '--version'])
    const match = `${result.stdout}${result.stderr}`.match(/Python 3\.(\d+)/)
    if (result.ok && match && Number(match[1]) >= 8) return [cmd, ...pre]
  }
  return undefined
}

const { items, base } = collect()
const copies = group(items)
const scope = has('--changed') ? `main から変えた文言（${base.slice(0, 7)} から）` : `${COPY_ROOT} のすべての文言`

if (copies.length === 0) {
  console.log(`${scope}：日本語の文言はありません`)
  process.exit(0)
}

const placesOf = (copy) => (copy.places.length > 1 ? `${copy.places[0]}（ほか ${copy.places.length - 1} か所）` : copy.places[0])

if (has('--list')) {
  console.log(`${scope}：${copies.length} 件\n`)
  for (const copy of copies) console.log(`${placesOf(copy)}\t${copy.text}`)
  process.exit(0)
}

const python = findPython()
if (!python) {
  console.log(`${scope}：${copies.length} 件。Python 3.8 以上が見つからないので、lint を飛ばしました`)
  console.log('文言の一覧は npm run copy:check -- --list で出せます。AI に「UI の文言を yomiyasu で点検して」と頼む方法もあります')
  process.exit(0)
}

// 1 行に 1 つの文言を、空の行をはさんで並べる（lint が段落ごとに見るので、文言どうしを混ぜない）
const dir = mkdtempSync(join(tmpdir(), 'copy-check-'))
const draft = join(dir, 'ui-copy.txt')
const lineToCopy = new Map()
const body = copies.map((copy, index) => {
  lineToCopy.set(index * 2 + 1, copy)
  return copy.text
})
writeFileSync(draft, `${body.join('\n\n')}\n`, 'utf8')
const [cmd, ...pre] = python
const result = run(cmd, [...pre, join(root, LINT), '--json', draft], { cwd: root, env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, timeout: 120_000 })
rmSync(dir, { recursive: true, force: true })

let report
try {
  report = JSON.parse(result.stdout)
} catch {
  console.log(`yomiyasu の lint を動かせませんでした（${relative(root, join(root, LINT))}）。点検は飛ばします`)
  if (result.stderr.trim()) console.log(result.stderr.trim().split('\n').slice(-3).join('\n'))
  process.exit(0)
}

// 文言をつないだ下書きは 1 つの文書ではないので、文書全体や文をまたいで見る規則の候補は外す
// （excess_bold と excess_list は 1 行目を指し、文末の重複は関係のない文言どうしを比べてしまう）
const DOCUMENT_RULES = new Set(['excess_bold', 'excess_list', 'sentence_end_repetition'])
const findings = (report.findings ?? []).filter((item) => lineToCopy.has(item.line) && !DOCUMENT_RULES.has(item.rule))
console.log(`${scope}を、yomiyasu の lint で点検しました（yomiyasu ${report.tool_version ?? ''}）`)
console.log(`文言 ${copies.length} 件、見直し候補 ${findings.length} 件\n`)
for (const item of findings) {
  const copy = lineToCopy.get(item.line)
  console.log(`${placesOf(copy)} [${String(item.severity).toUpperCase()}] ${item.rule}: ${item.message}`)
  console.log(`  > ${copy.text}\n`)
}
console.log('候補は機械の目安です。直すかどうかは画面の文脈で決めます。意味まで見て直すなら、AI に「UI の文言を yomiyasu で点検して」と頼みます（docs/ui/README.md「画面の文言」）')
