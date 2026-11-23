// 手元のagyだけで増築する。既定は計画表示。--executeを付けたときだけ生成する。
import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { validateEntries } from './model-library.mjs'

const require = createRequire(import.meta.url)
const { modelKey, libraryEntry } = require('../functions/lib/features/build-model/logic/library.js')
const { PREBUILT_MODELS } = require('../functions/lib/features/build-model/logic/prebuilt.js')
const { CATALOGUE } = require('../functions/lib/features/suggest-places/logic/catalogue.js')
const { PIN_CATEGORIES } = require('../functions/lib/domain/pin.js')
const { buildModelTask } = require('../functions/lib/features/build-model/prompt.js')
const { findAgy, generateWithAgy } = require('../functions/lib/adapters/gemini/agy.js')

export const PREFECTURES = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ')
export const TARGET_PER_PREFECTURE = 100
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKSPACE = join(ROOT, '.harness/model-library-expansion')
const normalized = (value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ja')
const placeKey = (identity) => JSON.stringify([normalized(identity.name), normalized(identity.area)])
// アプリは模型を斜め上のカメラ(40,33,40)から原点へ向けて見る。画面の左下の辺が+z側、右下の辺が+x側、奥が-x・-z側になる。
// 部品は台座の四角のxzに沿わせたまま、手前を低く奥を高く並べ、回さなくても見た目が分かるようにする（#431、手本は熱海温泉）。
export const VIEW_RULE = [
  '【向きと配置】アプリは模型を斜め上のカメラ(40,33,40)から見る。見えるのは+z側の面と+x側の面と上面で、-x・-z側の面は見えない。',
  '台座は軸に沿った四角のまま。建物・道・川・海岸・石垣などの部品も台座のx・zの軸に沿わせ、rotationのyは0か90か180か270にする。カメラに合わせて45度などに斜めに回さない（木や小物の少しの傾きはよい）。',
  'その場所を代表する一番良い見た目（建物の正面・門、滝の落ちる面、岩壁の見せ場、観覧車の輪の面）は、見える+z側か+x側へ向ける。',
  '舞台のように、手前(+z・+x側)に低いもの（水辺・道・広場）、奥(-z・-x側)ほど高いもの（山・崖・森・高い建物）を置き、段々に高くして見せ場を隠さない。',
  '例：海沿いの温泉街なら、+z側の辺に沿って海と砂浜、その奥に一段高い土地と旅館、いちばん奥に城や山を置く。',
  'Google Mapsの情報、API、外部ツールは使わない。',
].join('')
// 候補は、旅行者がピンにしやすい定番から順に、その県らしいジャンルで選ばせる（#431）。
// 辞書は名前・地域・種類が一致したときだけ使われるので、よく使われる正式名称で出させる。
export function candidatePrompt(pref, count, existing) {
  return [
    `${pref}の旅行アプリの建物辞書に追加する、実在する場所を${count}件選んでください。`,
    '旅行者が実際によく訪れる定番の観光地から順に選ぶ。ガイドブックの最初に載るような有名な場所を優先し、知る人ぞ知る場所は選ばない。',
    `種類は ${PIN_CATEGORIES.join(', ')} のどれか（onsen=温泉、ski=スキー場、food=名物グルメの店や市場・横丁、farm=牧場・農園・花畑、nightview=夜景、nature=自然・景勝地、shrine=寺社・城・史跡、themepark=テーマパーク・水族館・動物園・遊べる施設、town=街並み・商店街）。これ以外の値は使わない。`,
    '既存候補と合わせて、その県らしい種類を偏らせずに散らす。shrine・nature・town・food はたいていの県にあるので早めに入れる。その県では定番と言えない種類（例：東京の温泉、沖縄のスキー）は選ばない。同じ種類は既存候補と合わせて3件まで。',
    '名前は、旅行者や検索で最もよく使われる正式な表記にする（例：「華厳の滝」）。別名で同じ場所を水増ししない。実在と市町村に自信がある場所だけ。',
    'Google Mapsの情報やAPI、外部ツールは使わない。',
    `JSON配列だけを返す。各要素は {"name":"場所の名前","area":"${pref}市町村名（例：${pref}〇〇市）","category":"上の種類の値","description":"模型に表す外観の特徴（40字ほど）"}。`,
    `次の既存候補は除く：${JSON.stringify(existing.map(({ name, area, category }) => ({ name, area, category })))}`,
  ].join('\n')
}
// 模型を1回の呼び出しでまとめて作る（2026-11-22）。agyは毎回の前置きの入力で枠が減るので、まとめると1件あたりの枠と時間が約3分の1になる。
// 1件ずつと同じ指示（buildModelTask.promptの形とルール、VIEW_RULE）を並べ、順番どおりの配列で返させる。検査は1件ずつ行う。
export const MAX_PER_CALL = 5
export function batchModelPrompt(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_PER_CALL) throw new Error(`まとめて作るのは1〜${MAX_PER_CALL}件です`)
  const one = buildModelTask.prompt({ ...items[0], wishText: '' })
  const rule = one.slice(one.indexOf('次の形の JSON'))
  return [
    `旅行の計画アプリで、地図の上に置く小さな 3D の模型（ローポリのジオラマ）を ${items.length} 件作ります。`,
    ...items.map((item, index) => `${index + 1}. 場所の名前：${JSON.stringify(item.name)} 説明：${JSON.stringify(item.description)}`),
    '実在の建物を正確に再現する必要はありません。その場所らしさが一目で伝わる形にしてください。',
    '各模型は下の形とルールに従う。' + rule.replace('次の形の JSON だけを返してください。', '各模型は次の形の JSON にする。'),
    VIEW_RULE,
    `出力は、上の順番どおり ${items.length} 個の模型 JSON を並べた JSON 配列 [模型1, 模型2, ...] だけにする。`,
  ].join('\n')
}
// 配列の n 番目を n 件目の模型として検査する。崩れた件だけ null にし、ほかは使う
export function batchModelEntries(items, json) {
  return items.map((item, index) => (Array.isArray(json) && json[index] ? libraryEntry(item, { source: 'argon', json: json[index] }) : null))
}
// 模型に使ってよいモデル。Hydrogenは、Argonの週の枠を使い切ったときにLazyturtle0852（かめ）が許した（2026-11-22、todo/humans/2026-11-22-hydrogen-model-generation.md）。AGY_ARGON_MODELで明示したときだけ使う
export const MODEL_GENERATORS = ['gemini-4-argon-medium', 'gemini-4-hydrogen-medium']
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const seed = CATALOGUE.map(({ name, pref, city, category, description }) => ({ name, area: pref + city, category, description }))

export function validateCandidates(values, pref, existing = []) {
  if (!PREFECTURES.includes(pref) || !Array.isArray(values) || values.length === 0 || values.length > 100) throw new Error('都道府県と1〜100件の候補配列を指定します')
  const seen = new Set(existing.map(placeKey))
  return values.map((value) => {
    if (!value || !['name', 'area', 'description'].every((key) => typeof value[key] === 'string' && value[key].trim())
      || value.name.length > 100 || value.area.length > 100 || value.description.length > 400
      || !value.area.startsWith(pref) || !PIN_CATEGORIES.includes(value.category)) throw new Error('候補の名前・都道府県から始まる地域・種類・説明を確かめてください')
    const item = { name: value.name.trim(), area: value.area.trim(), category: value.category, description: value.description.trim() }
    const key = placeKey(item)
    if (!modelKey(item) || seen.has(key)) throw new Error(`候補が重複しています：${item.name}`)
    seen.add(key)
    return item
  })
}

export function mergeModels(base, added) {
  const entries = new Map(validateEntries(base).map((entry) => [entry.key, entry]))
  for (const entry of validateEntries(added)) {
    if (entries.has(entry.key)) throw new Error(`既存模型を上書きしません：${entry.identity.name}`)
    entries.set(entry.key, entry)
  }
  const values = [...entries.values()].map((entry) => ({ provider: 'agy', identity: entry.identity, model: entry.model }))
  validateEntries(values)
  return values
}

export function pendingCandidates(candidates, entries) {
  const keys = new Set(entries.map((entry) => entry.key))
  return candidates.filter((item) => !keys.has(modelKey(item)))
}

export function assertAvailableModel(output, model) {
  if (!output.split(/\r?\n/u).some((line) => line.split(/\s/u)[0] === model)) throw new Error(`${model} が利用できません。Argonを使えるアカウントへ切り替えて agy models を確認してください。別モデルには切り替えません`)
}

function savedModels() {
  const dir = join(WORKSPACE, 'models')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => /^[a-f0-9]{64}\.json$/u.test(file)).map((file) => {
    const value = readJson(join(dir, file))
    const [entry] = validateEntries([value])
    if (entry.key + '.json' !== file) throw new Error(`模型のファイル名と場所が違います：${file}`)
    return value
  })
}

function candidatesFor(pref) {
  const file = join(WORKSPACE, 'candidates', `${pref}.json`)
  const saved = existsSync(file) ? validateCandidates(readJson(file), pref) : []
  const existing = seed.filter((item) => item.area.startsWith(pref))
  if (saved.length) validateCandidates(saved, pref, existing)
  return [...existing, ...saved]
}

async function withLock(action) {
  mkdirSync(WORKSPACE, { recursive: true })
  const path = join(WORKSPACE, 'batch.lock')
  const fd = openSync(path, 'wx')
  try { return await action() } finally { closeSync(fd); unlinkSync(path) }
}

function ensureModel(model) {
  const bin = findAgy()
  if (!bin) throw new Error('agyが見つかりません。AGY_BINに実行ファイルを指定してください')
  assertAvailableModel(execFileSync(bin, ['models'], { encoding: 'utf8', timeout: 30000, windowsHide: true }), model)
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    prefecture: { type: 'string' }, limit: { type: 'string', default: '20' }, execute: { type: 'boolean', default: false }, 'per-call': { type: 'string', default: '1' },
  } })
  const command = positionals[0] ?? 'status'
  if (positionals.length > 1 || !['status', 'candidates', 'generate', 'export'].includes(command)) throw new Error('status | candidates | generate | export を指定します')
  const pref = values.prefecture
  if (pref && !PREFECTURES.includes(pref)) throw new Error('都道府県は正式名称で指定します（例：長野県）')
  const limit = Number(values.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('--limitは1〜20です。日次の既存agy予算も適用します')
  const perCall = Number(values['per-call'])
  if (!Number.isInteger(perCall) || perCall < 1 || perCall > MAX_PER_CALL) throw new Error(`--per-callは1〜${MAX_PER_CALL}です`)
  const run = () => runBatch(command, pref, limit, values.execute, perCall)
  if (command === 'export' || (command !== 'status' && values.execute)) await withLock(run)
  else await run()
}

async function runBatch(command, pref, limit, execute, perCall = 1) {
  const base = PREBUILT_MODELS.map((entry) => ({ provider: 'agy', identity: entry.identity, model: entry.model }))
  // 配布用辞書へ登録済みの模型は、作業フォルダに残っていても追加分に数えない（登録後の再開で上書き扱いにしない）
  const registered = new Set(PREBUILT_MODELS.map((entry) => entry.key))
  const saved = savedModels().filter((value) => !registered.has(modelKey(value.identity)))
  const combined = mergeModels(base, saved)
  const entries = validateEntries(combined)
  if (command === 'status') {
    for (const item of PREFECTURES.filter((item) => !pref || item === pref)) {
      const count = entries.filter((entry) => entry.identity.area.startsWith(item)).length
      console.log(`${item}: 検証済み${count}/${TARGET_PER_PREFECTURE}件、候補${candidatesFor(item).length}件`)
    }
    console.log(`合計${entries.length}/4700件。既存${base.length}件、追加${saved.length}件。保存先：${WORKSPACE}`)
    return
  }
  if (command === 'export') {
    const output = join(WORKSPACE, `models-${Date.now()}.json`)
    writeFileSync(output, JSON.stringify(combined, null, 2), { flag: 'wx' })
    console.log(`既存模型を保って${combined.length}件を検証しました：${output}`)
    return
  }
  if (!pref) throw new Error('--prefectureを指定します')
  const candidates = candidatesFor(pref)
  const completed = entries.filter((entry) => entry.identity.area.startsWith(pref)).length
  const missing = Math.max(0, TARGET_PER_PREFECTURE - candidates.length)
  const pending = pendingCandidates(candidates, entries).slice(0, Math.min(limit, Math.max(0, TARGET_PER_PREFECTURE - completed)))
  console.log(`${pref}: ${command === 'candidates' ? `候補を最大${Math.min(limit, missing)}件追加` : `未生成${pending.length}件を生成`}。${execute ? '生成を実行します' : '計画表示のみ。生成する場合は--executeを付けます'}`)
  if (!execute || (command === 'generate' ? pending.length === 0 : missing === 0)) return
  const model = command === 'generate' ? (process.env.AGY_ARGON_MODEL?.trim() || 'gemini-4-argon-medium') : (process.env.AGY_FLASH_MODEL?.trim() || 'gemini-3.8-flash-high')
  if (command === 'generate' ? !MODEL_GENERATORS.includes(model) : model !== 'gemini-3.8-flash-high') throw new Error('候補はgemini-3.8-flash-high、模型はgemini-4-argon-medium（明示したときだけgemini-4-hydrogen-medium）を使います')
  ensureModel(model)
  await generateBatch(command, pref, limit, missing, candidates, pending, model, perCall)
}

async function generateBatch(command, pref, limit, missing, candidates, pending, model, perCall = 1) {
    if (command === 'candidates') {
      const count = Math.min(limit, missing)
      const prompt = candidatePrompt(pref, count, candidates)
      const raw = JSON.parse(await generateWithAgy('flash', prompt))
      const added = []
      for (const value of Array.isArray(raw) ? raw : []) {
        // 1件の不備で全部を捨てない。弾いた理由を残し、通ったものだけ保存する
        try { added.push(...validateCandidates([value], pref, [...candidates, ...added])) }
        catch (error) { console.warn(`候補を除きました（${error.message}）：${JSON.stringify(value)}`) }
      }
      if (added.length === 0) throw new Error('使える候補が1件もありません')
      if (added.length > count) throw new Error('頼んだ件数を超えています')
      const file = join(WORKSPACE, 'candidates', `${pref}.json`)
      mkdirSync(dirname(file), { recursive: true })
      const previous = existsSync(file) ? readJson(file) : []
      writeFileSync(file + '.tmp', JSON.stringify([...previous, ...added], null, 2))
      renameSync(file + '.tmp', file)
      console.log(`${added.length}件の候補を保存しました。実在・表記・重複を人が確認してからgenerateを実行します：${file}`)
      return
    }
    mkdirSync(join(WORKSPACE, 'models'), { recursive: true })
    const todo = pending.filter((item) => !existsSync(join(WORKSPACE, 'models', `${modelKey(item)}.json`)))
    for (let start = 0; start < todo.length; start += perCall) {
      const group = todo.slice(start, start + perCall)
      const prompt = perCall === 1 ? buildModelTask.prompt({ ...group[0], wishText: '' }) + '\n' + VIEW_RULE : batchModelPrompt(group)
      try {
        const json = JSON.parse(await generateWithAgy('argon', prompt))
        const entries = perCall === 1 ? [libraryEntry(group[0], { source: 'argon', json })] : batchModelEntries(group, json)
        group.forEach((item, index) => {
          const entry = entries[index]
          // 1件ずつのときは下の catch が記録して止める。まとめたときは崩れた件だけ記録して残りを保存する
          if (!entry) { if (perCall > 1) appendFileSync(join(WORKSPACE, 'failures.jsonl'), JSON.stringify({ key: modelKey(item), name: item.name, at: new Date().toISOString(), error: '模型の検証に失敗しました' }) + '\n'); return }
          const file = join(WORKSPACE, 'models', `${modelKey(item)}.json`)
          const value = { provider: 'agy', identity: entry.identity, model: entry.model,
            generation: { model, generatedAt: new Date().toISOString(), promptSha256: createHash('sha256').update(prompt).digest('hex'), ...(perCall > 1 ? { batched: group.length } : {}) } }
          const temp = `${file}.${randomUUID()}.tmp`
          writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' })
          renameSync(temp, file)
          console.log(`保存：${item.name}`)
        })
        if (perCall === 1 && !entries[0]) throw new Error('模型の検証に失敗しました')
      } catch (error) {
        for (const item of group) appendFileSync(join(WORKSPACE, 'failures.jsonl'), JSON.stringify({ key: modelKey(item), name: item.name, at: new Date().toISOString(), error: error.message }) + '\n')
        throw error // 予算超過・不正JSON・認証失敗は止める。成功分は次回スキップする。
      }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
