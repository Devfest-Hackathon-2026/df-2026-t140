// ローカルGeminiで作った模型の一覧を検証し、配布用のTypeScriptデータにする。本番には接続しない。
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { libraryEntry } = require('../functions/lib/features/build-model/logic/library.js')
// 全国4700件と既存分を収める。模型1件ごとの部品・サイズの制限は変えない。
export const MAX_LIBRARY_ENTRIES = 5000

export function validateEntries(values) {
  if (!Array.isArray(values) || values.length > MAX_LIBRARY_ENTRIES) throw new Error(`模型は${MAX_LIBRARY_ENTRIES}件以内の配列にします`)
  const entries = values.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`${index + 1}件目：場所と模型を指定します`)
    if (value.provider !== 'agy') throw new Error(`${index + 1}件目：ローカルGemini（agy）で生成した模型を指定します`)
    const entry = libraryEntry(value.identity ?? {}, value.model ?? {})
    if (!entry) throw new Error(`${index + 1}件目：場所・模型・出典の形式を確かめてください`)
    return entry
  })
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) throw new Error('同じ場所が重複しています')
  return entries
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2)
  if (!input) throw new Error('入力JSONを指定してください。例：node scripts/model-library.mjs work/models.json')
  const entries = validateEntries(JSON.parse(readFileSync(input, 'utf8')))
  if (output) {
    const target = resolve('functions/src/features/build-model/logic/prebuilt.ts')
    if (resolve(output) !== target) throw new Error('出力先は functions/src/features/build-model/logic/prebuilt.ts にします')
    // 1件を1行にする。整形すると1000件で20MBを超え、Functionsの読み込みとリポジトリが重くなる（#431）
    writeFileSync(target, `import type { LibraryEntry } from './library'\n\n// ローカルGemini（agy）で生成し、scripts/model-library.mjsで検証した模型。1件1行。\nexport const PREBUILT_MODELS: readonly LibraryEntry[] = [\n${entries.map((entry) => `${JSON.stringify(entry)},\n`).join('')}]\n`)
  }
  console.log(`${entries.length}件の模型を検証しました${output ? '。配布用辞書に登録しました' : '（保存なし）'}`)
}
