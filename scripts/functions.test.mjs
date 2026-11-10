// Functions の純粋な処理と、Gemini の呼び出し口の切り替えを、Emulator なしで確かめる。
// 使い方：npm run build のあとに node --test scripts/functions.test.mjs
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

const require = createRequire(import.meta.url)
const { currentProvider, extractJson, gemini, needsPermit, runGemini } = require('../functions/lib/adapters/gemini/index.js')
const budget = require('../functions/lib/domain/geminiBudget.js')
const unlock = require('../functions/lib/features/unlock-ai/logic.js')
const { decideUnlock, PASSPHRASE_MAX } = unlock
const { classify: classifyVertexError, vertexModelName, ARGON_TIMEOUT_MS } = require('../functions/lib/adapters/gemini/vertex.js')
const { routesPermit } = require('../functions/lib/features/propose-routes/usecase.js')
const shioriTravel = require('../functions/lib/features/shiori-travel/logic.js')
const { travelAllowed } = require('../functions/lib/features/shiori-travel/usecase.js')
const routesApi = require('../functions/lib/adapters/routes-api.js')
const { modelPermit } = require('../functions/lib/features/build-model/usecase.js')
const { permitFor: placesPermit } = require('../functions/lib/features/suggest-places/usecase.js')
const placesApiModule = require('../functions/lib/adapters/places-api.js')
const verifyPlace = require('../functions/lib/features/verify-place/logic.js')
const { verifyPlaceForPin } = require('../functions/lib/features/verify-place/usecase.js')
const { placeReviews } = require('../functions/lib/features/place-reviews/usecase.js')
const reviewsLogic = require('../functions/lib/features/place-reviews/logic.js')
const kg = require('../functions/lib/adapters/knowledge-graph.js')
const { buildModelTask } = require('../functions/lib/features/build-model/prompt.js')

const { ping, pingTask } = require('../functions/lib/features/ping/logic.js')
const { ProviderConfigError, ProviderUnavailableError } = require('../functions/lib/adapters/gemini/errors.js')
const agy = require('../functions/lib/adapters/gemini/agy.js')
const { parseMaxCalls, withinBudget, budgetKey, DEFAULT_AGY_MAX_CALLS } = require('../functions/lib/domain/agyBudget.js')
const suggest = require('../functions/lib/features/suggest-places/logic/index.js')
const { suggestPlacesTask } = require('../functions/lib/features/suggest-places/prompt.js')
const { CATALOGUE } = require('../functions/lib/features/suggest-places/logic/catalogue.js')
const { PIN_CATEGORIES, BUILD_LIMIT_PER_TRIP, canRequestBuild } = require('../functions/lib/domain/pin.js')
const { MODEL_LIMITS, validateModelJson } = require('../functions/lib/domain/model3d.js')
const build = require('../functions/lib/features/build-model/logic/index.js')

const { decideBuildRequest } = require('../functions/lib/features/request-build/logic.js')
const plan = require('../functions/lib/domain/routePlan.js')
const { originLocation } = require('../functions/lib/domain/originPlaces.js')
const { MIN_PLACES_FOR_ROUTES } = require('../functions/lib/domain/route.js')
const propose = require('../functions/lib/features/propose-routes/logic.js')
const { proposeRoutesTask } = require('../functions/lib/features/propose-routes/prompt.js')
const tally = require('../functions/lib/features/tally-votes/logic.js')

const task = {
  name: 'test',
  model: 'flash',
  prompt: (input) => `入力：${input}`,
  parse(json) {
    if (typeof json?.answer !== 'string') throw new Error('answer がありません')
    return { answer: json.answer }
  },
  stub: (input) => ({ answer: `固定：${input}` }),
}

const quiet = () => {}
const originalWarn = console.warn
console.warn = quiet
// 偽の agy の「呼びました」のログもテストの出力に混ぜない
console.info = quiet

// agy が入っている開発者の Mac でも、このテストから本物の agy を起動しない：
// 実行ファイルは存在しない場所にし、回数の記録もテスト用のフォルダに向ける
const NO_AGY = '/nonexistent/agy'
process.env.AGY_BIN = NO_AGY
process.env.AGY_BUDGET_DIR = mkdtempSync(join(tmpdir(), 'konbu-agy-test-'))

afterEach(() => {
  delete process.env.GEMINI_PROVIDER
  delete process.env.AGY_MAX_CALLS
  delete process.env.AGY_MAX_ARGON_CALLS
  process.env.AGY_BIN = NO_AGY
  agy.resetAgyCallsInProcess()
})

test('GEMINI_PROVIDER がなければ stub', () => {
  assert.equal(currentProvider(), 'stub')
})

test('GEMINI_PROVIDER に知らない値が入っていたら stub', () => {
  process.env.GEMINI_PROVIDER = 'openai'
  assert.equal(currentProvider(), 'stub')
})

test('stub は固定の応答を返し、本物を呼ばない', async () => {
  let called = 0
  const result = await runGemini(task, '温泉', { generate: async () => ((called += 1), '{}') })
  assert.deepEqual(result, { output: { answer: '固定：温泉' }, provider: 'stub', fellBack: false })
  assert.equal(called, 0)
})

// ---- vertex（Cloud の Gemini、費用がかかる）：印（合言葉と回数の上限を通した）がなければ呼ばない ----

test('vertex は、印がなければ本物を呼ばず固定の応答に戻る（戻したことが分かる）', async () => {
  process.env.GEMINI_PROVIDER = 'vertex'
  let called = 0
  const result = await runGemini(task, '温泉', { generate: async () => ((called += 1), '{"answer":"本物"}') })
  assert.deepEqual(result, { output: { answer: '固定：温泉' }, provider: 'stub', fellBack: true })
  assert.equal(called, 0, '印がないのに本物を呼んだ')
  assert.equal(needsPermit('vertex'), true)
  assert.equal(needsPermit('agy'), false)
  assert.equal(needsPermit('stub'), false)
})

test('vertex は、印があれば本物を呼ぶ', async () => {
  process.env.GEMINI_PROVIDER = 'vertex'
  const result = await runGemini(task, '温泉', {
    permit: { uid: 'u1' },
    generate: async () => '{"answer":"本物"}',
  })
  assert.deepEqual(result, { output: { answer: '本物' }, provider: 'vertex', fellBack: false })
})

test('vertex の Argon は、印がなければ呼ばず、印があれば呼ぶ', async () => {
  process.env.GEMINI_PROVIDER = 'vertex'
  const argonTask = { ...task, model: 'argon' }
  const models = []
  const generate = async (model) => (models.push(model), '{"answer":"本物"}')
  const locked = await runGemini(argonTask, '模型', { generate })
  assert.deepEqual(locked, { output: { answer: '固定：模型' }, provider: 'stub', fellBack: true })
  assert.equal(models.length, 0, '印がないのに Argon を呼んだ')
  const result = await runGemini(argonTask, '模型', { permit: { uid: 'u1' }, generate })
  assert.deepEqual(result, { output: { answer: '本物' }, provider: 'vertex', fellBack: false })
  assert.deepEqual(models, ['argon'])
})

test('vertex のモデル名：VERTEX_FLASH_MODEL と VERTEX_ARGON_MODEL で変えられる。Argon の待ち時間は 2 回分が建築の 540 秒に収まる', () => {
  const saved = { flash: process.env.VERTEX_FLASH_MODEL, argon: process.env.VERTEX_ARGON_MODEL }
  try {
    delete process.env.VERTEX_FLASH_MODEL
    delete process.env.VERTEX_ARGON_MODEL
    assert.equal(vertexModelName('flash'), 'gemini-3.8-flash')
    assert.equal(vertexModelName('argon'), 'gemini-4-argon')
    process.env.VERTEX_ARGON_MODEL = ' gemini-4-argon-medium '
    assert.equal(vertexModelName('argon'), 'gemini-4-argon-medium')
    assert.equal(vertexModelName('flash'), 'gemini-3.8-flash')
    process.env.VERTEX_ARGON_MODEL = '  '
    assert.equal(vertexModelName('argon'), 'gemini-4-argon')
  } finally {
    for (const [key, name] of [['flash', 'VERTEX_FLASH_MODEL'], ['argon', 'VERTEX_ARGON_MODEL']]) {
      if (saved[key] === undefined) delete process.env[name]
      else process.env[name] = saved[key]
    }
  }
  assert.ok(ARGON_TIMEOUT_MS * 2 < 540_000)
})

test('vertex の Flash は、プロジェクトが分からない環境（このテスト）では固定の応答に戻る', async () => {
  process.env.GEMINI_PROVIDER = 'vertex'
  const saved = { a: process.env.GCLOUD_PROJECT, b: process.env.GOOGLE_CLOUD_PROJECT }
  delete process.env.GCLOUD_PROJECT
  delete process.env.GOOGLE_CLOUD_PROJECT
  try {
    const result = await gemini.run(task, '温泉', { permit: { uid: 'u1' } })
    assert.deepEqual(result, { output: { answer: '固定：温泉' }, provider: 'stub', fellBack: true })
    const argon = await gemini.run({ ...task, model: 'argon' }, '模型', { permit: { uid: 'u1' } })
    assert.deepEqual(argon, { output: { answer: '固定：模型' }, provider: 'stub', fellBack: true })
  } finally {
    if (saved.a !== undefined) process.env.GCLOUD_PROJECT = saved.a
    if (saved.b !== undefined) process.env.GOOGLE_CLOUD_PROJECT = saved.b
  }
})

test('geminiBudget：Flash は累計 300 回まで。壊れた記録は上限扱い', () => {
  assert.equal(budget.FLASH_TOTAL_MAX, 300)
  assert.equal(budget.withinFlashBudget(0), true)
  assert.equal(budget.withinFlashBudget(299), true)
  assert.equal(budget.withinFlashBudget(300), false)
  assert.equal(budget.withinFlashBudget(-1), false)
  assert.equal(budget.readCount(undefined), 0)
  assert.equal(budget.readCount(null), 0)
  assert.equal(budget.readCount(12), 12)
  assert.equal(budget.readCount('12'), 300)
  assert.equal(budget.readCount(Number.NaN), 300)
  assert.equal(budget.decideAiGate({ unlocked: false, reserved: true }), 'locked')
  assert.equal(budget.decideAiGate({ unlocked: true, reserved: false }), 'exhausted')
  assert.equal(budget.decideAiGate({ unlocked: true, reserved: true }), 'ok')
})

test('合言葉：設定がなければ必ず断る。合う・合わない・空・長すぎる', () => {
  assert.equal(decideUnlock('kotoba', undefined), 'not-configured')
  assert.equal(decideUnlock('kotoba', '   '), 'not-configured')
  assert.equal(decideUnlock('kotoba', 'kotoba'), 'ok')
  assert.equal(decideUnlock(' kotoba ', 'kotoba'), 'ok')
  assert.equal(decideUnlock('kotobA', 'kotoba'), 'wrong')
  assert.equal(decideUnlock('kotob', 'kotoba'), 'wrong')
  assert.equal(decideUnlock('kotobaa', 'kotoba'), 'wrong')
  assert.equal(decideUnlock('', 'kotoba'), 'invalid')
  assert.equal(decideUnlock(undefined, 'kotoba'), 'invalid')
  assert.equal(decideUnlock(123, 'kotoba'), 'invalid')
  assert.equal(decideUnlock('x'.repeat(PASSPHRASE_MAX + 1), 'kotoba'), 'invalid')
})

test('agy が入っていない環境（CI、本番）では、固定の応答に戻る（戻したことが分かる）', async () => {
  process.env.GEMINI_PROVIDER = 'agy'
  assert.equal(agy.findAgy({ AGY_BIN: NO_AGY, PATH: '/nonexistent/bin' }), null)
  const result = await gemini.run(task, '温泉')
  assert.deepEqual(result, { output: { answer: '固定：温泉' }, provider: 'stub', fellBack: true })
  assert.equal(agy.agyCallsUsed(), 0, 'agy を起動していないのに数えている')
})

// ---- agy の実体：偽の agy（封筒を書くだけのシェルスクリプト）で、起動の仕方と回数の上限を確かめる ----

/**
 * 偽の agy を作る。呼ばれた回数と受け取った引数を記録し、決めた封筒を stdout に書く。
 * 回数の記録もこのテスト専用のフォルダに向ける（テストどうしで数が混ざらない）
 */
function fakeAgy(envelope) {
  const dir = mkdtempSync(join(tmpdir(), 'konbu-fake-agy-'))
  const log = join(dir, 'calls.log')
  const bin = join(dir, 'agy')
  const line = JSON.stringify(envelope).replaceAll("'", "'\\''")
  // 文には改行が入るので、1 回の呼び出しを \x1e（記録の区切り）で区切る。echo は \n を解釈することがあるので printf
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\036' "$*" >> "${log}"\nprintf '%s\\n' 'ログの行（封筒ではない）'\nprintf '%s\\n' '${line}'\n`)
  chmodSync(bin, 0o755)
  process.env.AGY_BUDGET_DIR = dir
  const read = () => {
    try {
      return readFileSync(log, 'utf8').split('\x1e').filter(Boolean)
    } catch {
      return []
    }
  }
  return { bin, calls: read }
}

test('agy の封筒（stdout の最後の行の JSON）から応答の文を取り出す', () => {
  assert.deepEqual(agy.parseEnvelope('進捗のログ\n{"status":"SUCCESS","response":"{\\"a\\":1}"}\n'), { status: 'SUCCESS', response: '{"a":1}' })
  assert.throws(() => agy.parseEnvelope(''))
  assert.throws(() => agy.parseEnvelope('JSON ではない'))
})

test('agy を子プロセスで呼び、Flash のモデルと文を渡し、応答の文を返す', async () => {
  const fake = fakeAgy({ status: 'SUCCESS', response: '```json\n{"answer": "本物の白骨温泉"}\n```' })
  process.env.AGY_BIN = fake.bin
  process.env.GEMINI_PROVIDER = 'agy'
  const result = await gemini.run(task, '温泉')
  assert.deepEqual(result, { output: { answer: '本物の白骨温泉' }, provider: 'agy', fellBack: false })
  const [args] = fake.calls()
  assert.match(args, /--output-format json/)
  assert.match(args, /--model gemini-3\.8-flash-high/)
  assert.match(args, /-p=入力：温泉/)
  assert.match(args, /出力のルール/, '出力の決まりを文に足していない')
  assert.doesNotMatch(args, /dangerously|json-schema/)
  assert.equal(agy.agyCallsUsed(), 1)
})

test('agy が失敗の封筒を返したら、やり直さずに固定の応答に戻る', async () => {
  const fake = fakeAgy({ status: 'ERROR', error: 'not logged in' })
  process.env.AGY_BIN = fake.bin
  process.env.GEMINI_PROVIDER = 'agy'
  const result = await gemini.run(task, '温泉')
  assert.deepEqual(result, { output: { answer: '固定：温泉' }, provider: 'stub', fellBack: true })
  assert.equal(fake.calls().length, 1)
})

test('Argon の仕事は Argon のモデルで agy を呼び、Flash とは別の回数で数える', async () => {
  const fake = fakeAgy({ status: 'SUCCESS', response: '{"answer": "本物の模型"}' })
  process.env.AGY_BIN = fake.bin
  process.env.GEMINI_PROVIDER = 'agy'
  const result = await gemini.run({ ...task, model: 'argon' }, '模型')
  assert.deepEqual(result, { output: { answer: '本物の模型' }, provider: 'agy', fellBack: false })
  const [args] = fake.calls()
  assert.match(args, /--model gemini-4-argon-medium/)
  assert.match(args, /--print-timeout 4m/)
  assert.equal(agy.agyCallsUsed('argon'), 1)
  assert.equal(agy.agyCallsUsed('flash'), 0)
})

test('Argon の回数の上限（AGY_MAX_ARGON_CALLS）に達したら、agy を起動しないで固定の応答に戻る。Flash は呼べる', async () => {
  const fake = fakeAgy({ status: 'SUCCESS', response: '{"answer": "本物"}' })
  process.env.AGY_BIN = fake.bin
  process.env.GEMINI_PROVIDER = 'agy'
  process.env.AGY_MAX_ARGON_CALLS = '1'
  const argon = { ...task, model: 'argon' }
  assert.equal((await gemini.run(argon, '1')).provider, 'agy')
  assert.deepEqual(await gemini.run(argon, '2'), { output: { answer: '固定：2' }, provider: 'stub', fellBack: true })
  assert.equal(fake.calls().length, 1)
  const record = JSON.parse(readFileSync(join(process.env.AGY_BUDGET_DIR, budgetKey(new Date(), 'argon')), 'utf8'))
  assert.equal(record.count, 1)
  assert.equal((await gemini.run(task, 'Flash')).provider, 'agy')
  delete process.env.AGY_MAX_ARGON_CALLS
})

test('回数の上限（AGY_MAX_CALLS）に達したら、agy を起動しないで固定の応答に戻る', async () => {
  const fake = fakeAgy({ status: 'SUCCESS', response: '{"answer": "本物"}' })
  process.env.AGY_BIN = fake.bin
  process.env.GEMINI_PROVIDER = 'agy'
  process.env.AGY_MAX_CALLS = '2'
  assert.equal((await gemini.run(task, '1')).provider, 'agy')
  assert.equal((await gemini.run(task, '2')).provider, 'agy')
  const third = await gemini.run(task, '3')
  assert.deepEqual(third, { output: { answer: '固定：3' }, provider: 'stub', fellBack: true })
  assert.equal(fake.calls().length, 2)
  // 日付ごとの記録（OS の一時フォルダ）にも残り、プロセスを立て直しても数が戻らない
  const record = JSON.parse(readFileSync(join(process.env.AGY_BUDGET_DIR, budgetKey(new Date())), 'utf8'))
  assert.equal(record.count, 2)
  agy.resetAgyCallsInProcess()
  assert.equal(agy.agyCallsUsed(), 2)
  assert.equal((await gemini.run(task, '4')).provider, 'stub')
  assert.equal(fake.calls().length, 2)
})

test('回数の上限の判断（domain）', () => {
  assert.equal(DEFAULT_AGY_MAX_CALLS, 30)
  assert.equal(parseMaxCalls(undefined), 30)
  assert.equal(parseMaxCalls(''), 30)
  assert.equal(parseMaxCalls('abc'), 30)
  assert.equal(parseMaxCalls('-1'), 30)
  assert.equal(parseMaxCalls('0'), 0)
  assert.equal(parseMaxCalls('5'), 5)
  assert.equal(withinBudget(0, 1), true)
  assert.equal(withinBudget(1, 1), false)
  assert.equal(budgetKey(new Date(2026, 10, 7)), 'konbu-agy-calls-2026-11-07.json')
})

test('本物の応答が決めた形なら、そのまま返す（```json で囲まれていても読む）', async () => {
  process.env.GEMINI_PROVIDER = 'agy'
  const prompts = []
  const result = await runGemini(task, '温泉', {
    generate: async (model, prompt) => (prompts.push([model, prompt]), '```json\n{"answer": "白骨温泉"}\n```'),
  })
  assert.deepEqual(result, { output: { answer: '白骨温泉' }, provider: 'agy', fellBack: false })
  assert.deepEqual(prompts, [['flash', '入力：温泉']])
})

test('形が違えば 1 回だけやり直す', async () => {
  process.env.GEMINI_PROVIDER = 'agy'
  const replies = ['JSON ではない文', '{"answer": "2 回目"}']
  const result = await runGemini(task, '温泉', { generate: async () => replies.shift() })
  assert.deepEqual(result, { output: { answer: '2 回目' }, provider: 'agy', fellBack: false })
})

test('2 回とも形が違えば、固定の応答に戻る', async () => {
  process.env.GEMINI_PROVIDER = 'agy'
  let called = 0
  const result = await runGemini(task, '温泉', { generate: async () => ((called += 1), '{"wrong": true}') })
  assert.deepEqual(result, { output: { answer: '固定：温泉' }, provider: 'stub', fellBack: true })
  assert.equal(called, 2)
})

test('呼べない環境では、やり直さずに固定の応答に戻る', async () => {
  process.env.GEMINI_PROVIDER = 'agy'
  let called = 0
  const result = await runGemini(task, '温泉', {
    generate: async () => {
      called += 1
      throw new ProviderUnavailableError('agy が入っていません')
    },
  })
  assert.equal(result.fellBack, true)
  assert.equal(called, 1)
})

test('extractJson は前後の一言を除いて読み、JSON でなければ例外を投げる', () => {
  assert.deepEqual(extractJson(' {"a": 1} '), { a: 1 })
  assert.deepEqual(extractJson('以下が JSON です。\n{"a": {"b": [1, 2]}}\n以上です。'), { a: { b: [1, 2] } })
  assert.throws(() => extractJson('こんにちは'))
  assert.throws(() => extractJson('{ こわれた'))
})

test('ping の logic は、渡された呼び出し口の結果をそのまま返す', async () => {
  const seen = []
  const fake = { run: async (givenTask, input) => (seen.push(givenTask), { output: givenTask.stub(input), provider: 'stub', fellBack: false }) }
  const response = await ping({ gemini: fake })
  assert.deepEqual(response, { text: pingTask.stub().text, provider: 'stub', fellBack: false })
  assert.deepEqual(seen, [pingTask])
  assert.throws(() => pingTask.parse({ text: '' }))
  assert.deepEqual(pingTask.parse({ text: '楽しみ' }), { text: '楽しみ' })
})

// ---- 希望 → ピン（features/suggest-places） ----

const names = (places) => places.map((place) => place.name)
const search = (text, bounds = null, exclude = []) => names(suggest.searchCatalogue({ text, bounds, exclude }))
// 長野を中心に、関東から東海までを映した範囲
const CHUBU = { north: 37.6, south: 34.6, east: 140.2, west: 136.4 }
const HOKKAIDO = { north: 45.5, south: 41.5, east: 145.5, west: 139.5 }

test('見本の場所の一覧は、決めた形で、位置が日本の中にある', () => {
  assert.ok(CATALOGUE.length >= 100)
  assert.equal(new Set(CATALOGUE.map((entry) => entry.name)).size, CATALOGUE.length, '同じ名前が 2 つある')
  for (const entry of CATALOGUE) {
    assert.ok(PIN_CATEGORIES.includes(entry.category), entry.name)
    assert.ok(entry.name.length > 0 && entry.name.length <= 40, entry.name)
    assert.ok(entry.description.length > 0 && entry.description.length <= 40, `${entry.name} の説明が長い`)
    assert.match(entry.pref, /^(北海道|.+[都府県])$/, entry.name)
    assert.ok(entry.lat > 24 && entry.lat < 46 && entry.lng > 123 && entry.lng < 146, entry.name)
  }
  // どの種類にも、候補の数（3 件）以上ある
  for (const category of PIN_CATEGORIES) {
    assert.ok(CATALOGUE.filter((entry) => entry.category === category).length >= 3, category)
  }
})

test('場所を書かなければ、地図で映している範囲から探す', () => {
  const found = suggest.searchCatalogue({ text: '温泉に入りたい', bounds: CHUBU, exclude: [] })
  assert.equal(found.length, 3)
  for (const place of found) {
    assert.equal(place.category, 'onsen')
    assert.ok(place.location.lat <= CHUBU.north && place.location.lat >= CHUBU.south, place.name)
    assert.ok(place.location.lng <= CHUBU.east && place.location.lng >= CHUBU.west, place.name)
  }
  // 北海道を映していれば、北海道の温泉が先に出る
  assert.equal(search('温泉に入りたい', HOKKAIDO)[0], '登別温泉')
})

test('場所を書けば、地図の範囲より、書かれた場所を優先する', () => {
  assert.deepEqual(search('新潟の温泉！', HOKKAIDO), ['月岡温泉', '越後湯沢温泉', '赤倉温泉'])
  assert.deepEqual(search('信州でスキー', HOKKAIDO).length, 3)
  for (const place of suggest.searchCatalogue({ text: '信州でスキー', bounds: HOKKAIDO, exclude: [] })) {
    assert.match(place.area, /^長野県/)
  }
  // 「東京都」を「京都」と見まちがえない
  assert.deepEqual(suggest.detectArea('東京都で神社').prefs, ['東京都'])
  assert.deepEqual(suggest.detectArea('京都のお寺').prefs, ['京都府'])
  // 「山形」の「山」を、自然と見まちがえない
  assert.deepEqual(suggest.detectCategories(suggest.detectArea('山形で遊びたい').rest), ['themepark'])
})

test('広く映しているとき（日本全体）と、範囲がないときは、全国から探す', () => {
  const japan = { north: 46, south: 28, east: 148, west: 128 }
  assert.deepEqual(search('温泉', japan), search('温泉', null))
  assert.deepEqual(search('温泉', null), ['草津温泉', '箱根湯本温泉', '別府温泉'])
})

test('言葉に合う場所を選ぶ（わさび、スキー、夜景、名前そのもの）', () => {
  assert.deepEqual(search('わさび農園に行きたい', CHUBU).sort(), ['大王わさび農場', '奥多摩のわさび田', '筏場のわさび田'].sort())
  for (const place of suggest.searchCatalogue({ text: 'スキー場で滑りたい', bounds: CHUBU, exclude: [] })) {
    assert.equal(place.category, 'ski')
  }
  for (const place of suggest.searchCatalogue({ text: '夜景と一生の思い出を作りたい！', bounds: CHUBU, exclude: [] })) {
    assert.equal(place.category, 'nightview')
  }
  // 名前を書けば、映している範囲の外でも、その場所が先頭に出る
  assert.equal(search('白骨温泉に行きたい', HOKKAIDO)[0], '白骨温泉')
  assert.equal(search('熱海に行きたい')[0], '熱海温泉')
})

test('範囲の中に足りなければ近い順に足し、もうある場所は出さない', () => {
  const tokyo = { north: 35.8, south: 35.55, east: 139.9, west: 139.55 }
  assert.deepEqual(search('温泉', tokyo), ['箱根湯本温泉', '熱海温泉', '鬼怒川温泉'])
  const first = search('温泉', CHUBU)
  const second = search('温泉', CHUBU, first)
  assert.equal(second.length, 3)
  assert.equal(second.filter((name) => first.includes(name)).length, 0)
})

test('言葉から種類が分からなくても、範囲の中の場所を出す', () => {
  assert.equal(search('のんびりしたい', CHUBU).length, 3)
  const anywhere = suggest.searchCatalogue({ text: 'あああ', bounds: null, exclude: [] })
  assert.equal(new Set(anywhere.map((place) => place.category)).size, 3, '種類が片寄っている')
})

test('Gemini の応答の形を確かめる（希望 → ピン）', () => {
  const good = { name: '白骨温泉', description: '乳白色の湯', area: '長野県松本市', category: 'onsen', lat: 36.15, lng: 137.63 }
  assert.deepEqual(suggest.parseSuggestOutput({ places: [good] }), {
    places: [{ name: '白骨温泉', description: '乳白色の湯', area: '長野県松本市', category: 'onsen', location: { lat: 36.15, lng: 137.63 } }],
  })
  // 0 件は「見つからなかった」として通す
  assert.deepEqual(suggest.parseSuggestOutput({ places: [] }), { places: [] })
  // 形が違う
  assert.throws(() => suggest.parseSuggestOutput(null))
  assert.throws(() => suggest.parseSuggestOutput({ places: '白骨温泉' }))
  assert.throws(() => suggest.parseSuggestOutput([good]))
  // 名前がない、位置が数字でない、位置が日本の外：その候補だけ捨てる。全部だめなら例外
  const bad = [{ ...good, name: '' }, { ...good, lat: '36.15' }, { ...good, lat: 48.85, lng: 2.35 }, null]
  assert.deepEqual(names(suggest.parseSuggestOutput({ places: [...bad, good] }).places), ['白骨温泉'])
  assert.throws(() => suggest.parseSuggestOutput({ places: bad }))
  // 知らない種類は town、長すぎる文は切る、余分な項目は落とす
  const odd = suggest.parseSuggestOutput({ places: [{ ...good, category: 'casino', description: 'あ'.repeat(500), code: 'alert(1)' }] }).places[0]
  assert.equal(odd.category, 'town')
  assert.equal(odd.description.length, 140)
  assert.equal('code' in odd, false)
})

test('候補は 3 件まで。同じ名前と、もうある場所は除く', () => {
  const place = (name) => ({ name, description: '', area: '', category: 'onsen', location: { lat: 36, lng: 138 } })
  const output = { places: ['A', 'B', 'A', 'C', 'D', 'E'].map(place) }
  assert.deepEqual(names(suggest.pickCandidates(output, ['B'])), ['A', 'C', 'D'])
  assert.equal(suggest.candidatePinId('wish1', 0), 'wish1-1')
})

test('場所を探す仕事は、利用者の言葉と範囲だけを送り、固定の応答は一覧から選ぶ', () => {
  const input = { text: '温泉に入りたい', bounds: CHUBU, exclude: ['白骨温泉'] }
  const prompt = suggestPlacesTask.prompt(input)
  assert.match(prompt, /温泉に入りたい/)
  assert.match(prompt, /白骨温泉/)
  assert.equal(suggestPlacesTask.model, 'flash')
  const stub = suggestPlacesTask.stub(input)
  assert.equal(stub.places.length, 3)
  assert.equal(names(stub.places).includes('白骨温泉'), false)
  // 固定の応答も、本物の応答と同じ形の確かめを通る
  const asJson = { places: stub.places.map((p) => ({ ...p, lat: p.location.lat, lng: p.location.lng })) }
  assert.deepEqual(suggestPlacesTask.parse(asJson), stub)
})

// ---- 模型の JSON（domain/model3d）と、建築（features/request-build、features/build-model） ----

const box = (overrides = {}) => ({ shape: 'box', size: [2, 1, 2], position: [0, 0.5, 0], color: '#AABBCC', ...overrides })
const model = (...parts) => ({ version: 1, parts })

test('模型の JSON：決めた形なら通し、決めた項目だけを取り出す', () => {
  const input = model(box({ rotation: [0, 45, 0], opacity: 0.5, onClick: 'alert(1)' }), box({ shape: 'roof' }))
  input.script = 'alert(1)'
  assert.deepEqual(validateModelJson(input), {
    version: 1,
    parts: [
      { shape: 'box', size: [2, 1, 2], position: [0, 0.5, 0], color: '#aabbcc', rotation: [0, 45, 0], opacity: 0.5 },
      { shape: 'roof', size: [2, 1, 2], position: [0, 0.5, 0], color: '#aabbcc' },
    ],
  })
})

test('模型の JSON：形、大きさ、位置、色、部品の数が違えば断る', () => {
  const bad = [
    null,
    'コード',
    [],
    { version: 2, parts: [box()] },
    { version: 1 },
    model(),
    model(...Array.from({ length: MODEL_LIMITS.maxParts + 1 }, () => box())),
    model(box({ shape: 'teapot' })),
    model(box({ size: [1, 1] })),
    model(box({ size: [1, '1', 1] })),
    model(box({ size: [0, 1, 1] })),
    model(box({ size: [1, 100, 1] })),
    model(box({ size: [1, Number.NaN, 1] })),
    model(box({ position: [20, 0, 0] })),
    model(box({ position: [0, 30, 0] })),
    model(box({ position: [0, -5, 0] })),
    model(box({ color: 'red' })),
    model(box({ color: '#fff' })),
    model(box({ rotation: [0, 720, 0] })),
    model(box({ opacity: 0 })),
    model(box({ opacity: '1' })),
    model(null),
  ]
  for (const json of bad) assert.throws(() => validateModelJson(json), JSON.stringify(json)?.slice(0, 80))
  // 上限ちょうどは通る
  assert.equal(validateModelJson(model(...Array.from({ length: MODEL_LIMITS.maxParts }, () => box()))).parts.length, MODEL_LIMITS.maxParts)
})

test('部品の模型は、どの種類も検査を通り、土台の板から始まる', () => {
  for (const category of PIN_CATEGORIES) {
    const prefab = build.prefabFor(category)
    assert.deepEqual(validateModelJson(prefab), prefab, category)
    assert.ok(prefab.parts.length >= 8, `${category} の部品が少ない`)
    assert.deepEqual(prefab.parts[0].size, [10, 0.6, 10], category)
  }
  // 知らない種類は「街歩き」の模型。返した模型を書き換えても、元は変わらない
  assert.deepEqual(build.prefabFor('casino'), build.prefabFor('town'))
  build.prefabFor('onsen').parts.length = 0
  assert.ok(build.prefabFor('onsen').parts.length > 0)
})

test('建築の依頼：メンバーなら誰でも。上限は 20 棟。工事中と完成は、もう一度は受けない', () => {
  const facts = (overrides = {}) => ({ isMember: true, pinStatus: 'candidate', builtCount: 0, ...overrides })
  assert.equal(BUILD_LIMIT_PER_TRIP, 20)
  assert.equal(decideBuildRequest(facts()), 'ok')
  assert.equal(decideBuildRequest(facts({ builtCount: 19 })), 'ok')
  assert.equal(decideBuildRequest(facts({ builtCount: 20 })), 'limit-reached')
  assert.equal(decideBuildRequest(facts({ isMember: false })), 'not-member')
  assert.equal(decideBuildRequest(facts({ pinStatus: undefined })), 'not-found')
  assert.equal(decideBuildRequest(facts({ pinStatus: 'building' })), 'already-built')
  assert.equal(decideBuildRequest(facts({ pinStatus: 'done' })), 'already-built')
  // 失敗したものは、もう一度建てられる
  assert.equal(decideBuildRequest(facts({ pinStatus: 'failed' })), 'ok')
  assert.deepEqual(['candidate', 'building', 'done', 'failed'].map(canRequestBuild), [true, false, false, true])
})

test('模型を作る処理が引き受けるのは、「工事中」で、まだ引き受けられていないピンだけ', () => {
  assert.equal(build.shouldStartBuild({ status: 'building', buildStartedAt: null }), true)
  assert.equal(build.shouldStartBuild({ status: 'building' }), true)
  assert.equal(build.shouldStartBuild({ status: 'building', buildStartedAt: { toMillis: () => 1 } }), false)
  assert.equal(build.shouldStartBuild({ status: 'candidate', buildStartedAt: null }), false)
  assert.equal(build.shouldStartBuild({ status: 'done', buildStartedAt: null }), false)
  assert.equal(build.shouldStartBuild(undefined), false)
})

test('保存する模型：固定の応答は parts、本物は argon、形が違えば部品の模型に差し替える', () => {
  const prefab = build.prefabFor('onsen')
  assert.deepEqual(build.chooseModel({ output: prefab, provider: 'stub', fellBack: false }, 'onsen'), { json: prefab, source: 'parts' })
  // 本物を頼んだが固定の応答に戻った（fellBack）ときも、部品の模型として記録する
  assert.equal(build.chooseModel({ output: prefab, provider: 'stub', fellBack: true }, 'onsen').source, 'parts')
  const made = model(box())
  assert.deepEqual(build.chooseModel({ output: made, provider: 'vertex', fellBack: false }, 'onsen'), {
    json: validateModelJson(made),
    source: 'argon',
  })
  assert.deepEqual(build.chooseModel({ output: { version: 1, parts: 'こわれた応答' }, provider: 'vertex', fellBack: false }, 'shrine'), {
    json: build.prefabFor('shrine'),
    source: 'parts',
  })
})

test('模型を作る仕事は、名前・説明・希望の文だけを送り、固定の応答は種類に合う部品の模型', () => {
  const input = { name: '大王わさび農場', description: '湧き水のわさび田', wishText: 'わさび農園に行きたい', category: 'farm' }
  const prompt = buildModelTask.prompt(input)
  assert.equal(buildModelTask.model, 'argon')
  for (const word of ['大王わさび農場', '湧き水のわさび田', 'わさび農園に行きたい', 'JSON']) assert.ok(prompt.includes(word), word)
  assert.deepEqual(buildModelTask.stub(input), build.prefabFor('farm'))
  assert.throws(() => buildModelTask.parse({ version: 1, parts: [] }))
})

// ---- ルートの計算（domain/routePlan）と、ルート案（features/propose-routes） ----

// 信州の 3 か所と、東京。a、b、c は希望を書いた人
const TOKYO = { name: '東京駅', location: { lat: 35.68, lng: 139.77 } }
const NO_ORIGIN = { name: 'どこか', location: null }
const place = (id, lat, lng, uid = 'a', category = 'onsen') => ({ id, name: `場所 ${id}`, location: { lat, lng }, uid, category })
const WASABI = place('p1', 36.33, 137.9, 'a', 'farm')
const SHIRAHONE = place('p2', 36.15, 137.63, 'b', 'onsen')
const UTSUKUSHI = place('p3', 36.23, 138.11, 'c', 'nightview')
const HAKUBA = place('p4', 36.7, 137.83, 'a', 'ski')
const ids = (order) => order.map((item) => item.id)

test('移動時間は、直線距離から見積もる（5 分きざみ。道のりは 1.3 倍、時速 60 km、乗り降り 10 分）', () => {
  // 東京 → 大阪は、直線でおよそ 400 km
  const tokyoOsaka = plan.distanceKm(TOKYO.location, { lat: 34.7, lng: 135.5 })
  assert.ok(tokyoOsaka > 395 && tokyoOsaka < 410, String(tokyoOsaka))
  assert.equal(plan.distanceKm(WASABI.location, WASABI.location), 0)
  assert.equal(plan.moveMinutes(0), 10)
  assert.equal(plan.moveMinutes(10), 25) // 13 分 ＋ 10 分 → 25 分
  assert.equal(plan.moveMinutes(100), 140)
  assert.equal(plan.moveMinutes(100) % 5, 0)
})

test('出発地の名前から、およその位置を引く。表にない名前は null', () => {
  assert.deepEqual(originLocation('東京駅'), { lat: 35.68, lng: 139.77 })
  assert.deepEqual(originLocation('新大阪駅'), { lat: 34.73, lng: 135.5 })
  assert.deepEqual(originLocation('京都駅 八条口'), { lat: 34.99, lng: 135.76 })
  assert.equal(originLocation('うちの前'), null)
  // 1 文字の名前（津）は、先頭にあるときだけ
  assert.equal(originLocation('会津若松'), null)
  assert.ok(originLocation('津駅'))
})

test('3 つの案の順番は、互いに違う。移動が短い順、その逆まわり、全員の希望が早めに入る順', () => {
  for (const places of [
    [WASABI, SHIRAHONE, UTSUKUSHI],
    [WASABI, SHIRAHONE, UTSUKUSHI, HAKUBA],
    [WASABI, SHIRAHONE, UTSUKUSHI, HAKUBA, place('p5', 36.65, 138.19, 'b', 'shrine')],
    // 全員が同じ人の希望でも、3 つとも違う順番になる
    [place('x1', 36, 138), place('x2', 36.1, 138.1), place('x3', 36.2, 138.3)],
  ]) {
    for (const origin of [TOKYO, NO_ORIGIN]) {
      const orders = plan.proposeOrders(places, origin)
      const keys = plan.STYLE_ORDER.map((style) => ids(orders[style]).join('>'))
      assert.equal(new Set(keys).size, 3, `同じ順番の案がある：${keys.join(' / ')}`)
      for (const style of plan.STYLE_ORDER) assert.deepEqual(ids(orders[style]).sort(), ids(places).sort())
      // shortest は、ほかのどの順番よりも短い（か同じ）
      const shortest = plan.pathKm(orders.shortest, origin)
      assert.ok(shortest <= plan.pathKm(orders.wishes, origin) + 1e-9)
      assert.ok(shortest <= plan.pathKm(places, origin) + 1e-9)
      assert.deepEqual(ids(orders.relaxed), ids(orders.shortest).reverse())
    }
  }
  // 入力の並びが違っても、同じ結果になる
  const one = plan.proposeOrders([WASABI, SHIRAHONE, UTSUKUSHI, HAKUBA], TOKYO)
  const other = plan.proposeOrders([HAKUBA, UTSUKUSHI, SHIRAHONE, WASABI], TOKYO)
  assert.deepEqual(ids(one.wishes), ids(other.wishes))
  // wishes：a の場所が 2 つ（p1、p4）あっても、最初の 3 つに a、b、c が 1 つずつ入る
  assert.equal(new Set(one.wishes.slice(0, 3).map((item) => item.uid)).size, 3)
})

test('スケジュール：日ごとに、時刻、場所、滞在、次への移動。出発地が分かれば「出発」の行から始まる', () => {
  const order = [WASABI, SHIRAHONE, UTSUKUSHI]
  const timing = plan.STYLE_TIMINGS.shortest
  const day = plan.buildPlan(order, TOKYO, 1, timing)
  assert.equal(day.originIncluded, true)
  assert.deepEqual(day.schedule.map((stop) => stop.pinId), [null, 'p1', 'p2', 'p3'])
  assert.deepEqual(day.schedule.map((stop) => stop.day), [1, 1, 1, 1])
  assert.equal(day.schedule[0].name, '東京駅 出発')
  assert.equal(day.schedule[0].time, '09:00')
  assert.equal(day.schedule[0].stayMinutes, 0)
  // 時刻は、前の行の時刻 ＋ 滞在 ＋ 移動
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  for (let index = 1; index < day.schedule.length; index += 1) {
    const before = day.schedule[index - 1]
    assert.equal(minutes(day.schedule[index].time), minutes(before.time) + before.stayMinutes + before.moveMinutesToNext)
  }
  assert.equal(day.schedule.at(-1).moveMinutesToNext, null)
  assert.equal(day.totalMoveMinutes, day.schedule.reduce((sum, stop) => sum + (stop.moveMinutesToNext ?? 0), 0))
  assert.ok(day.totalDistanceKm > 150)

  // 出発地の位置が分からなければ、1 つ目の場所から始まる
  const unknown = plan.buildPlan(order, NO_ORIGIN, 1, timing)
  assert.equal(unknown.originIncluded, false)
  assert.deepEqual(unknown.schedule.map((stop) => stop.pinId), ['p1', 'p2', 'p3'])
  assert.equal(unknown.schedule[0].time, '09:00')

  // 2 日なら 2 か所と 1 か所。2 日目は、その日の始まりの時刻から。日をまたぐ移動も合計に入る
  const twoDays = plan.buildPlan(order, NO_ORIGIN, 2, plan.STYLE_TIMINGS.relaxed)
  assert.deepEqual(twoDays.schedule.map((stop) => stop.day), [1, 1, 2])
  assert.equal(twoDays.schedule[2].time, '10:00')
  assert.equal(twoDays.schedule[0].stayMinutes, 120)
  assert.ok(twoDays.schedule[1].moveMinutesToNext > 0)
  // 場所より日が多ければ、余った日は使わない
  assert.deepEqual(plan.buildPlan(order, NO_ORIGIN, 7, timing).schedule.map((stop) => stop.day), [1, 2, 3])
  assert.deepEqual(plan.splitIntoDays([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]])
  assert.equal(plan.clock(25 * 60), '23:59')
})

test('Routes API の時間：表にある区間はその時間（乗り降り 10 分を足し 5 分きざみ）、ない区間は直線距離の目安', () => {
  assert.equal(plan.routesMoveMinutes(3000), 60) // 50 分 ＋ 10 分
  assert.equal(plan.routesMoveMinutes(61), 15) // 1 分ちょっと ＋ 10 分 → 15 分
  const order = [WASABI, SHIRAHONE, UTSUKUSHI]
  // 区間は、出発地 → 1 つ目、そのあと順番どおり。出発地の位置が分からなければ、1 つ目から
  const legs = plan.travelLegs(order, TOKYO)
  assert.equal(legs.points.length, 4)
  assert.deepEqual(legs.keys, ['@origin>p1', 'p1>p2', 'p2>p3'])
  assert.deepEqual(plan.travelLegs(order, NO_ORIGIN).keys, ['p1>p2', 'p2>p3'])
  assert.deepEqual(plan.travelLegs([], TOKYO).keys, [])

  const timing = plan.STYLE_TIMINGS.shortest
  const all = plan.buildPlan(order, TOKYO, 1, timing, plan.travelTable(legs.keys, [7200, 1800, 2400]))
  assert.deepEqual(all.schedule.map((stop) => stop.moveMinutesToNext), [130, 40, 50, null])
  assert.equal(all.totalMoveMinutes, 220)
  assert.equal(all.schedule[1].time, '11:10') // 9:00 ＋ 130 分
  // 道がない区間（null）は目安に戻る
  const estimated = plan.buildPlan(order, TOKYO, 1, timing)
  const mixed = plan.buildPlan(order, TOKYO, 1, timing, plan.travelTable(legs.keys, [7200, null, 2400]))
  assert.equal(mixed.schedule[1].moveMinutesToNext, estimated.schedule[1].moveMinutesToNext)
  // 順番を決めるのは、いつも直線距離（表を渡しても、距離の合計は変わらない）
  assert.equal(all.totalDistanceKm, estimated.totalDistanceKm)
})

test('Routes API の呼び出し口：送る中身、応答の読み方、Emulator やキーなしでは呼ばない', () => {
  const body = routesApi.routesRequestBody([TOKYO.location, WASABI.location, SHIRAHONE.location, UTSUKUSHI.location])
  assert.equal(body.travelMode, 'DRIVE')
  assert.equal(body.routingPreference, 'TRAFFIC_UNAWARE')
  assert.equal(body.intermediates.length, 2)
  assert.deepEqual(body.origin.location.latLng, { latitude: 35.68, longitude: 139.77 })
  assert.deepEqual(routesApi.parseLegSeconds({ routes: [{ legs: [{ duration: '120s' }, { duration: '30.5s' }] }] }, 2), [120, 30.5])
  // 道がない（routes が空）なら全区間 null。区間の数が合わない・形が違うなら全体を null（目安に戻す）
  assert.deepEqual(routesApi.parseLegSeconds({}, 2), [null, null])
  assert.equal(routesApi.parseLegSeconds({ routes: [{ legs: [{ duration: '120s' }] }] }, 2), null)
  assert.equal(routesApi.parseLegSeconds({ routes: 'x' }, 1), null)
  assert.deepEqual(routesApi.parseLegSeconds({ routes: [{ legs: [{}] }] }, 1), [null])
  assert.equal(routesApi.routesApiEnabled({ ROUTES_API_KEY: 'k' }), true)
  assert.equal(routesApi.routesApiEnabled({ ROUTES_API_KEY: 'k', FUNCTIONS_EMULATOR: 'true' }), false)
  assert.equal(routesApi.routesApiEnabled({ ROUTES_API_KEY: '  ' }), false)
  assert.equal(routesApi.routesApiEnabled({}), false)
})

test('道の形（Routes の polyline）：読み方、間引き、区間との組み、開発環境の見本の線', () => {
  // Google の文書の例：(38.5, -120.2) (40.7, -120.95) (43.252, -126.453)
  assert.deepEqual(routesApi.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }])
  assert.equal(routesApi.decodePolyline('_p~iF'), null, '途中で切れた文字')
  const many = Array.from({ length: 1000 }, (_, i) => ({ lat: i, lng: i }))
  const thin = routesApi.thinPath(many)
  assert.equal(thin.length, routesApi.MAX_PATH_POINTS)
  assert.deepEqual([thin[0], thin.at(-1)], [many[0], many.at(-1)], '両端を残す')
  const legs = routesApi.parseLegs({ routes: [{ legs: [{ duration: '60s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }, { duration: '30s' }] }] }, 2)
  assert.deepEqual(legs.seconds, [60, 30])
  assert.equal(legs.paths[0].length, 3)
  assert.equal(legs.paths[1], null, '道の形がない区間は null（画面はまっすぐ結ぶ）')
  assert.deepEqual(shioriTravel.legPathsOf(['a>b', 'b>c'], legs.paths).map((leg) => leg.key), ['a>b'])
  assert.equal(routesApi.routesSampleMode({ FUNCTIONS_EMULATOR: 'true' }), true)
  assert.equal(routesApi.routesSampleMode({}), false)
  const sample = shioriTravel.sampleLegPaths([{ lat: 36, lng: 138 }, { lat: 36.5, lng: 138.5 }], ['@origin>p1'])
  assert.equal(sample[0].key, '@origin>p1')
  assert.equal(sample[0].points.length, 12)
  assert.deepEqual([sample[0].points[0], sample[0].points.at(-1)], [{ lat: 36, lng: 138 }, { lat: 36.5, lng: 138.5 }], '見本の線が場所を結んでいない')
})

test('しおりの移動時間（shioriTravel）：メンバー、しおりがある、呼べる設定、合言葉の順に確かめ、Routes の時間で計算し直す', () => {
  const gate = (state) => shioriTravel.travelGate({ member: true, found: true, enabled: true, unlocked: () => true, ...state })
  assert.deepEqual(gate({ member: false }), { status: 'not-member' })
  assert.deepEqual(gate({ found: false }), { status: 'not-found' })
  assert.deepEqual(gate({ enabled: false }), { status: 'estimate', reason: 'off' })
  assert.deepEqual(gate({ unlocked: () => false }), { status: 'estimate', reason: 'locked' })
  assert.equal(gate({}), null)

  // ルートの順に、建った場所を並べる（消えた場所は飛ばす）
  const order = shioriTravel.routeOrder({ pinIds: ['p3', 'gone', 'p1'] }, [WASABI, SHIRAHONE, UTSUKUSHI])
  assert.deepEqual(ids(order), ['p3', 'p1'])
  // Routes の秒で、時刻を計算し直す（出発地 → p3 → p1 の 2 区間）
  const plan2 = shioriTravel.replan({ style: 'shortest' }, order, TOKYO, 1, [7200, 1800])
  assert.deepEqual(plan2.schedule.map((stop) => stop.moveMinutesToNext), [130, 40, null])
  assert.equal(plan2.totalMoveMinutes, 170)
  assert.equal(plan2.schedule[2].time, '12:50') // 9:00 ＋ 130 分 ＋ 滞在 60 分 ＋ 40 分
  // どの区間も取れなければ null（画面は保存してある目安を出す）
  assert.equal(shioriTravel.replan({ style: 'shortest' }, order, TOKYO, 1, [null, null]), null)
})

test('しおりの移動時間（shioriTravel）：全員に開く切り替えが入っていれば、合言葉なしでも Routes を出す', async () => {
  const gate = (open, unlockedUids) => ({ isOpenToAll: async () => open, isUnlocked: async (uid) => unlockedUids.includes(uid) })
  assert.equal(await travelAllowed(gate(false, []), 'a'), false)
  assert.equal(await travelAllowed(gate(false, ['a']), 'a'), true)
  assert.equal(await travelAllowed(gate(true, []), 'a'), true)
})

test('旅の日数：終了日なしは 1 日、1 泊 2 日は 2 日', () => {
  assert.equal(plan.tripDays('2026-11-21', null), 1)
  assert.equal(plan.tripDays('2026-11-21', '2026-11-21'), 1)
  assert.equal(plan.tripDays('2026-11-21', '2026-11-22'), 2)
  assert.equal(plan.tripDays('2026-12-30', '2027-01-02'), 4)
})

const routesInput = (places = [WASABI, SHIRAHONE, UTSUKUSHI]) => ({ tripTitle: '秋の信州', origin: TOKYO, days: 2, places })

test('ルート案のトリガーは、ピンが「完成」になった瞬間だけ。場所が 3 つ以上で案を出す', () => {
  assert.equal(propose.becameDone({ status: 'building' }, { status: 'done' }), true)
  assert.equal(propose.becameDone({ status: 'done' }, { status: 'done' }), false)
  assert.equal(propose.becameDone({ status: 'candidate' }, { status: 'building' }), false)
  assert.equal(propose.becameDone(undefined, undefined), false)
  assert.equal(MIN_PLACES_FOR_ROUTES, 3)
  assert.equal(propose.enoughPlaces(2), false)
  assert.equal(propose.enoughPlaces(3), true)
  // 場所の組み合わせは、順番が違っても同じとみなす
  assert.equal(propose.placesKey(['p2', 'p1', 'p3']), propose.placesKey(['p3', 'p2', 'p1']))
  assert.notEqual(propose.placesKey(['p1', 'p2', 'p3']), propose.placesKey(['p1', 'p2', 'p4']))
})

test('ルート案を考える仕事：固定の応答は 3 案（A、B、C）で、本物の応答と同じ形の確かめを通る', () => {
  const input = routesInput()
  const prompt = proposeRoutesTask.prompt(input)
  assert.equal(proposeRoutesTask.model, 'flash')
  for (const word of ['秋の信州', '東京駅', '場所 p1', 'shortest', 'relaxed', 'wishes', 'JSON']) assert.ok(prompt.includes(word), word)
  const stub = proposeRoutesTask.stub(input)
  assert.deepEqual(stub.options.map((option) => option.style), ['shortest', 'relaxed', 'wishes'])
  assert.deepEqual(proposeRoutesTask.parse(JSON.parse(JSON.stringify(stub))), stub)
  // キャッチコピーは、回る順の場所の種類から作る
  assert.equal(propose.stubCatchphrase(['farm', 'onsen', 'nightview'], 'shortest'), '畑のめぐみと湯けむり、さくっとめぐる旅')
  assert.equal(propose.stubCatchphrase(['onsen', 'onsen'], 'relaxed'), '湯けむり、ゆったり味わう旅')
  for (const option of stub.options) assert.ok(option.catchphrase.length > 0 && option.catchphrase.length <= 40)
  // 形が違う応答は断る
  assert.throws(() => proposeRoutesTask.parse(null))
  assert.throws(() => proposeRoutesTask.parse({ options: stub.options.slice(0, 2) }))
  assert.throws(() => proposeRoutesTask.parse({ options: stub.options.map((option) => ({ ...option, style: 'shortest' })) }))
  assert.throws(() => proposeRoutesTask.parse({ options: stub.options.map((option) => ({ ...option, catchphrase: '' })) }))
})

test('採用する案：場所が抜けた・余った応答は、自分たちの計算に差し替える。保存する形にはスケジュールが付く', () => {
  const input = routesInput()
  const stub = propose.stubOptions(input)
  assert.equal(propose.chooseOptions({ output: stub, provider: 'stub', fellBack: false }, input).proposedBy, 'stub')
  const real = { options: stub.options.map((option) => ({ ...option, catchphrase: '本物の案' })) }
  assert.deepEqual(propose.chooseOptions({ output: real, provider: 'agy', fellBack: false }, input), { options: real.options, proposedBy: 'agy' })
  const missing = { options: real.options.map((option) => ({ ...option, pinIds: option.pinIds.slice(1) })) }
  const unknown = { options: real.options.map((option) => ({ ...option, pinIds: ['p1', 'p2', 'zzz'] })) }
  for (const output of [missing, unknown, 'こわれた応答']) {
    assert.deepEqual(propose.chooseOptions({ output, provider: 'agy', fellBack: false }, input), { options: stub.options, proposedBy: 'stub' })
  }

  const drafts = propose.draftRoutes(stub.options, input, 'stub', 2)
  assert.deepEqual(drafts.map((route) => route.id), ['g2-a', 'g2-b', 'g2-c'])
  assert.deepEqual(drafts.map((route) => route.label), ['A', 'B', 'C'])
  for (const route of drafts) {
    assert.equal(route.generation, 2)
    assert.equal(route.proposedBy, 'stub')
    assert.equal(route.originIncluded, true)
    assert.deepEqual(route.schedule.filter((stop) => stop.pinId).map((stop) => stop.pinId), route.pinIds)
    assert.ok(route.totalMoveMinutes > 0 && route.totalDistanceKm > 0)
    assert.deepEqual([...new Set(route.schedule.map((stop) => stop.day))], [1, 2])
  }
  // 案 B（ゆったり）は、滞在が長く、出発が遅い
  assert.equal(drafts[0].schedule[1].stayMinutes, 60)
  assert.equal(drafts[1].schedule[1].stayMinutes, 120)
  assert.equal(drafts[1].schedule[0].time, '10:00')
})

test('しおりのルート：建物が 1 つ建てば作る。「移動が短い」案から、ID を固定して 1 本だけ作る', () => {
  assert.equal(propose.enoughPlacesForShiori(0), false)
  assert.equal(propose.enoughPlacesForShiori(1), true)
  const one = routesInput([WASABI])
  const shiori = propose.draftShiori(propose.stubOptions(one).options, one, 'stub')
  assert.equal(shiori.id, 'shiori')
  assert.equal(shiori.style, 'shortest')
  assert.deepEqual(shiori.pinIds, [WASABI.id])
  // 出発地の行と、場所の行。時刻が付く
  assert.deepEqual(shiori.schedule.map((stop) => stop.pinId), [null, WASABI.id])
  assert.equal(shiori.schedule[0].time, '09:00')
  assert.ok(/^\d\d:\d\d$/.test(shiori.schedule[1].time))
  // 3 つでも 1 本。「移動が短い」案と同じ順番
  const three = routesInput()
  const options = propose.stubOptions(three).options
  const draft = propose.draftShiori(options, three, 'stub')
  assert.deepEqual(draft.pinIds, options.find((option) => option.style === 'shortest').pinIds)
  // 2 つ目からは、順番を保って足す（作り直さない）
  const update = propose.addToDecidedRoute(shiori, [WASABI, SHIRAHONE], TOKYO, 2)
  assert.deepEqual([...update.pinIds].sort(), [WASABI.id, SHIRAHONE.id])
  assert.equal(update.revision, 1)
  assert.deepEqual(update.addedPinIds, [SHIRAHONE.id])
})

// ---- 決定（features/tally-votes）と、決まったあとの組み直し（features/propose-routes） ----

const ABC = [
  { id: 'g1-a', label: 'A' },
  { id: 'g1-b', label: 'B' },
  { id: 'g1-c', label: 'C' },
]

test('決定：全員が投票するまで決めない。いちばん票の多い案に決まり、同数なら先の案（A、B、C の順）', () => {
  const decide = (...votes) => tally.decideRoute({ routes: ABC, votes })
  // まだ投票していない人がいる
  assert.equal(decide('g1-a', 'g1-a', null), null)
  assert.equal(decide(null), null)
  // ルート案がない、メンバーがいない
  assert.equal(tally.decideRoute({ routes: [], votes: ['g1-a'] }), null)
  assert.equal(tally.decideRoute({ routes: ABC, votes: [] }), null)
  // 作り直す前の案への票は、投票していない扱い
  assert.equal(decide('g1-a', 'g0-a'), null)
  // いちばん票の多い案
  assert.equal(decide('g1-b', 'g1-b', 'g1-a'), 'g1-b')
  assert.equal(decide('g1-c', 'g1-a', 'g1-c', 'g1-b'), 'g1-c')
  assert.equal(decide('g1-c'), 'g1-c')
  // 同数なら先の案。1 票ずつなら A、B と C が同数なら B
  assert.equal(decide('g1-c', 'g1-b', 'g1-a'), 'g1-a')
  assert.equal(decide('g1-c', 'g1-b'), 'g1-b')
  assert.equal(decide('g1-c', 'g1-b', 'g1-c', 'g1-b'), 'g1-b')
  // ルート案の並びが A、B、C の順でなくても、同じ結果
  assert.equal(tally.decideRoute({ routes: [...ABC].reverse(), votes: ['g1-c', 'g1-b', 'g1-a'] }), 'g1-a')
})

test('決定のトリガーは、「投票したルート」が変わったときと、メンバーが抜けたときだけ', () => {
  assert.equal(tally.voteChanged({ votedRouteId: null }, { votedRouteId: 'g1-a' }), true)
  assert.equal(tally.voteChanged({ votedRouteId: 'g1-a' }, { votedRouteId: 'g1-b' }), true)
  assert.equal(tally.voteChanged({ votedRouteId: 'g1-a' }, undefined), true)
  // 名前を変えただけ、参加しただけ（まだ投票していない）
  assert.equal(tally.voteChanged({ votedRouteId: 'g1-a' }, { votedRouteId: 'g1-a' }), false)
  assert.equal(tally.voteChanged(undefined, { votedRouteId: null }), false)
  assert.equal(tally.voteChanged(undefined, undefined), false)
})

test('決まったあとの追加：移動がいちばん増えない位置に入れ、ほかの場所の順番は変えない', () => {
  // 西から東へ一直線に並ぶ 3 か所
  const west = place('w', 36, 137)
  const middle = place('m', 36, 138)
  const east = place('e', 36, 139)
  const order = [west, middle, east]
  // 間の場所は間に、東の先は最後に、西の手前は先頭に入る
  assert.equal(plan.insertionIndex(order, place('x', 36, 137.5), NO_ORIGIN), 1)
  assert.equal(plan.insertionIndex(order, place('x', 36, 138.6), NO_ORIGIN), 2)
  assert.equal(plan.insertionIndex(order, place('x', 36, 139.5), NO_ORIGIN), 3)
  assert.equal(plan.insertionIndex(order, place('x', 36, 136.5), NO_ORIGIN), 0)
  // 出発地（東京）から 1 つ目へ行く途中の場所は、先頭に入る
  assert.equal(plan.insertionIndex([middle, west], place('x', 35.9, 139), TOKYO), 0)
  assert.equal(plan.insertionIndex([], place('x', 36, 138), TOKYO), 0)

  const route = { style: 'relaxed', pinIds: ['w', 'm', 'e'], revision: 0, addedPinIds: [] }
  const added = place('n', 36, 138.5, 'b')
  const update = propose.addToDecidedRoute(route, [west, middle, east, added], NO_ORIGIN, 2)
  assert.deepEqual(update.pinIds, ['w', 'm', 'n', 'e'])
  assert.equal(update.revision, 1)
  assert.deepEqual(update.addedPinIds, ['n'])
  // スケジュールは、その案の時間の決め（ゆったり：1 か所 120 分、10 時に出発）のまま計算し直す
  assert.deepEqual(update.schedule.map((stop) => stop.pinId), ['w', 'm', 'n', 'e'])
  assert.deepEqual(update.schedule.map((stop) => stop.day), [1, 1, 2, 2])
  assert.equal(update.schedule[0].time, '10:00')
  assert.equal(update.schedule[0].stayMinutes, 120)
  assert.ok(update.totalMoveMinutes > 0)
  // もう入っていれば、何もしない（同じイベントが 2 回来ても変わらない）
  assert.equal(propose.addToDecidedRoute({ ...route, ...update }, [west, middle, east, added], NO_ORIGIN, 2), null)
  // 2 つ目を足すと、回数が増え、足した順に残る
  const second = propose.addToDecidedRoute({ ...route, ...update }, [west, middle, east, added, place('z', 36, 139.4)], NO_ORIGIN, 2)
  assert.deepEqual(second.pinIds, ['w', 'm', 'n', 'e', 'z'])
  assert.equal(second.revision, 2)
  assert.deepEqual(second.addedPinIds, ['n', 'z'])
})

test('合言葉：5 回間違えると、最後に間違えてから 1 時間は断る。時間がたつと数え直す', () => {
  const { UNLOCK_FAILURE_MAX, UNLOCK_LOCK_MS, isLockedOut, readAttempts, recordFailure } = unlock
  assert.equal(UNLOCK_FAILURE_MAX, 5)
  assert.equal(UNLOCK_LOCK_MS, 60 * 60 * 1000)
  const start = 1_000_000_000_000
  let attempts = readAttempts(undefined)
  assert.deepEqual(attempts, { failures: 0, lastFailedAt: 0 })
  for (let index = 0; index < UNLOCK_FAILURE_MAX; index += 1) {
    assert.equal(isLockedOut(attempts, start + index), false, `${index} 回目のあとで断っている`)
    attempts = recordFailure(attempts, start + index)
  }
  assert.deepEqual(attempts, { failures: 5, lastFailedAt: start + 4 })
  // 6 回目からは断る（合言葉を見ない）
  assert.equal(isLockedOut(attempts, start + 5), true)
  assert.equal(isLockedOut(attempts, start + 4 + UNLOCK_LOCK_MS - 1), true)
  // 最後に間違えてから 1 時間たつと、また試せる。次に間違えたら 1 から数える
  assert.equal(isLockedOut(attempts, start + 4 + UNLOCK_LOCK_MS), false)
  assert.deepEqual(recordFailure(attempts, start + 4 + UNLOCK_LOCK_MS), { failures: 1, lastFailedAt: start + 4 + UNLOCK_LOCK_MS })
  // 時間内に続けて間違えると数が増える
  assert.deepEqual(recordFailure({ failures: 3, lastFailedAt: start }, start + 10), { failures: 4, lastFailedAt: start + 10 })
  // 壊れた記録は上限扱い（費用側に倒す）
  assert.equal(isLockedOut(readAttempts({ failures: '1', lastFailedAt: start }), start + 1), true)
  assert.equal(isLockedOut(readAttempts({ failures: 5, lastFailedAt: null }), start), true)
})

test('Vertex：設定の誤り（401・403・404）だけ数えた回数を戻す。429・400・通信の失敗は戻さない', () => {
  for (const status of [401, 403, 404]) {
    assert.equal(budget.isVertexConfigFailure(status), true)
    const error = classifyVertexError(Object.assign(new Error('x'), { status }))
    assert.ok(error instanceof ProviderConfigError, `${status} が設定の誤りになっていない`)
    assert.ok(error instanceof ProviderUnavailableError, `${status} でやり直してしまう`)
  }
  for (const status of [400, 429]) {
    assert.equal(budget.isVertexConfigFailure(status), false)
    const error = classifyVertexError(Object.assign(new Error('x'), { status }))
    assert.ok(error instanceof ProviderUnavailableError)
    assert.ok(!(error instanceof ProviderConfigError), `${status} で戻してしまう`)
  }
  for (const cause of [new Error('fetch failed'), Object.assign(new Error('x'), { status: 500 }), 'timeout']) {
    assert.ok(!(classifyVertexError(cause) instanceof ProviderUnavailableError))
  }
  assert.equal(budget.isVertexConfigFailure('404'), false)
  assert.equal(budget.refundedCount(12), 11)
  assert.equal(budget.refundedCount(0), 0)
  assert.equal(budget.refundedCount(300), 299)
  // 壊れた記録は書かない（上限扱いから 1 減らして、上限より下に戻さない）
  for (const broken of ['12', -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 301, undefined, null, {}]) {
    assert.equal(budget.refundedCount(broken), null, `${String(broken)} で書き戻してしまう`)
  }
  // 戻しても、上限と「呼ぶ前に数える」は変わらない
  assert.equal(budget.FLASH_TOTAL_MAX, 300)
})

test('呼び出し口：1 回目が設定の誤りのときだけ、印の refund を 1 回呼ぶ', async () => {
  process.env.GEMINI_PROVIDER = 'vertex'
  const run = async (failures) => {
    let refunds = 0
    let calls = 0
    const permit = { uid: 'u', refund: async () => { refunds += 1 } }
    const generate = async () => {
      const failure = failures[calls]
      calls += 1
      if (failure === 'ok') return '{"answer":"本物"}'
      if (failure === 'bad-json') return 'JSON ではない'
      throw failure
    }
    const result = await runGemini(task, '温泉', { permit, generate })
    return { refunds, calls, provider: result.provider }
  }
  assert.deepEqual(await run([new ProviderConfigError('404')]), { refunds: 1, calls: 1, provider: 'stub' })
  assert.deepEqual(await run([new ProviderUnavailableError('429')]), { refunds: 0, calls: 1, provider: 'stub' })
  assert.deepEqual(await run([new Error('fetch failed'), new Error('fetch failed')]), { refunds: 0, calls: 2, provider: 'stub' })
  // 1 回目は呼べていて（形が違った）、2 回目が設定の誤りなら戻さない
  assert.deepEqual(await run(['bad-json', new ProviderConfigError('403')]), { refunds: 0, calls: 2, provider: 'stub' })
  assert.deepEqual(await run(['ok']), { refunds: 0, calls: 1, provider: 'vertex' })
  // 戻すのに失敗しても、流れは止めない
  const failing = { uid: 'u', refund: async () => { throw new Error('Firestore') } }
  const result = await runGemini(task, '温泉', { permit: failing, generate: async () => { throw new ProviderConfigError('401') } })
  assert.equal(result.fellBack, true)
})

// ---- Argon（模型）の回数の上限：1 日 20 回・累計 80 回 ----

test('geminiBudget：Argon は 1 日 20 回・累計 80 回まで。日付が変わると 1 日の回数は 0 から', () => {
  assert.equal(budget.ARGON_DAILY_MAX, 20)
  assert.equal(budget.ARGON_TOTAL_MAX, 80)
  const today = '2026-11-07'
  assert.deepEqual(budget.reserveArgon({}, today), { count: 1, day: today, dayCount: 1 })
  assert.deepEqual(budget.reserveArgon({ count: 5, day: today, dayCount: 5 }, today), { count: 6, day: today, dayCount: 6 })
  assert.deepEqual(budget.reserveArgon({ count: 19, day: today, dayCount: 19 }, today), { count: 20, day: today, dayCount: 20 })
  assert.equal(budget.reserveArgon({ count: 20, day: today, dayCount: 20 }, today), null, '1 日の上限を超えた')
  assert.deepEqual(budget.reserveArgon({ count: 20, day: '2026-11-06', dayCount: 20 }, today), { count: 21, day: today, dayCount: 1 })
  assert.deepEqual(budget.reserveArgon({ count: 79, day: '2026-11-06', dayCount: 20 }, today), { count: 80, day: today, dayCount: 1 })
  assert.equal(budget.reserveArgon({ count: 80, day: '2026-11-06', dayCount: 3 }, today), null, '累計の上限を超えた')
  assert.equal(budget.reserveArgon({ count: 80, day: today, dayCount: 0 }, today), null)
})

test('geminiBudget：Argon の壊れた記録は上限扱い（呼ばない側に倒す）', () => {
  const today = '2026-11-07'
  for (const broken of ['3', -1, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.equal(budget.reserveArgon({ count: broken, day: today, dayCount: 0 }, today), null, `count=${String(broken)} で呼んでしまう`)
    assert.equal(budget.reserveArgon({ count: 0, day: today, dayCount: broken }, today), null, `dayCount=${String(broken)} で呼んでしまう`)
  }
  // 日付が壊れている、日付がないのに今日の回数だけある
  assert.equal(budget.reserveArgon({ count: 0, day: 20261107, dayCount: 0 }, today), null)
  assert.equal(budget.reserveArgon({ count: 0, dayCount: 3 }, today), null)
  assert.equal(budget.budgetDay(new Date('2026-11-07T14:59:59Z')), '2026-11-07')
  assert.equal(budget.budgetDay(new Date('2026-11-07T15:00:00Z')), '2026-11-08', '日本時間の 0 時で日付が変わる')
})

test('geminiBudget：Argon の 1 回を戻す。今日なら今日の回数も、壊れていれば何も書かない', () => {
  const today = '2026-11-07'
  assert.deepEqual(budget.refundArgon({ count: 5, day: today, dayCount: 2 }, today), { count: 4, dayCount: 1 })
  assert.deepEqual(budget.refundArgon({ count: 1, day: today, dayCount: 0 }, today), { count: 0, dayCount: 0 })
  // 日付が変わったあとは累計だけ
  assert.deepEqual(budget.refundArgon({ count: 5, day: '2026-11-06', dayCount: 2 }, today), { count: 4 })
  for (const broken of ['5', -1, 1.5, 81, Number.NaN, undefined, null]) {
    assert.equal(budget.refundArgon({ count: broken, day: today, dayCount: 1 }, today), null, `count=${String(broken)} で書き戻してしまう`)
  }
  for (const broken of ['1', -1, 1.5, 21, Number.NaN, undefined]) {
    assert.equal(budget.refundArgon({ count: 3, day: today, dayCount: broken }, today), null, `dayCount=${String(broken)} で書き戻してしまう`)
  }
})

/** 関所の代わり。合言葉を通した人と、数えた・戻した記録を持つ */
function fakeGate({ unlocked = [], flash = true, argon = true, open = false } = {}) {
  const log = []
  return {
    log,
    aiGate: {
      isOpenToAll: async () => open,
      isUnlocked: async (uid) => (log.push(`unlocked?${uid}`), unlocked.includes(uid)),
      reserveFlashCall: async () => (log.push('reserve:flash'), flash),
      refundFlashCall: async () => void log.push('refund:flash'),
      reserveArgonCall: async () => (log.push('reserve:argon'), argon),
      refundArgonCall: async () => void log.push('refund:argon'),
    },
  }
}

test('しおりのルート：建った場所の持ち主の誰かが合言葉を通していて、Flash の上限の中なら印を付ける', async () => {
  const ok = fakeGate({ unlocked: ['b'] })
  const permit = await routesPermit(ok, ['a', 'b', 'a', 'c'], 't1')
  assert.equal(permit?.uid, 'b')
  assert.deepEqual(ok.log, ['unlocked?a', 'unlocked?b', 'reserve:flash'])
  await permit.refund()
  assert.equal(ok.log.at(-1), 'refund:flash', 'ルートの refund は Flash の記録を戻す')

  // 誰も合言葉を通していなければ、回数を消費しない
  const locked = fakeGate()
  assert.equal(await routesPermit(locked, ['a', 'b'], 't1'), undefined)
  assert.deepEqual(locked.log, ['unlocked?a', 'unlocked?b'])

  // 上限に達していれば印を付けない
  const exhausted = fakeGate({ unlocked: ['a'], flash: false })
  assert.equal(await routesPermit(exhausted, ['a'], 't1'), undefined)
  assert.deepEqual(exhausted.log, ['unlocked?a', 'reserve:flash'])
})

test('模型：建てた人か希望を書いた人が合言葉を通していて、Argon の上限の中なら印を付ける', async () => {
  const builder = fakeGate({ unlocked: ['builder'] })
  const permit = await modelPermit(builder, ['builder', 'wisher'], 'p1')
  assert.equal(permit?.uid, 'builder')
  assert.deepEqual(builder.log, ['unlocked?builder', 'reserve:argon'])
  await permit.refund()
  assert.equal(builder.log.at(-1), 'refund:argon', '模型の refund は Argon の記録を戻す')

  const wisher = fakeGate({ unlocked: ['wisher'] })
  assert.equal((await modelPermit(wisher, [null, 'wisher'], 'p1'))?.uid, 'wisher')

  const locked = fakeGate({ unlocked: ['someone-else'] })
  assert.equal(await modelPermit(locked, ['builder', 'wisher'], 'p1'), undefined)
  assert.ok(!locked.log.includes('reserve:argon'), '合言葉を通していないのに Argon を数えた')

  const exhausted = fakeGate({ unlocked: ['wisher'], argon: false })
  assert.equal(await modelPermit(exhausted, ['builder', 'wisher'], 'p1'), undefined)
  assert.ok(!exhausted.log.includes('reserve:flash'), '模型が Flash の回数を使った')
})

test('全員に開く切り替え：openToAll が true のときだけ開く', () => {
  assert.equal(budget.readOpenToAll(true), true)
  for (const value of [undefined, null, false, 'true', 1, {}]) {
    assert.equal(budget.readOpenToAll(value), false, `${String(value)} で開いてしまう`)
  }
})

test('全員に開く切り替え：合言葉なしでも場所の候補・ルート・模型に印が付き、回数の上限はそのまま効く', async () => {
  // 場所の候補：書いた人が合言葉を通していなくても通す。合言葉は確かめない
  const places = fakeGate({ open: true })
  const permit = await placesPermit(places, 'judge', 'w1')
  assert.equal(permit?.uid, 'judge')
  assert.deepEqual(places.log, ['reserve:flash'])
  // 切っていれば、今までどおり合言葉が要る
  assert.equal(await placesPermit(fakeGate(), 'judge', 'w1'), undefined)

  const routes = fakeGate({ open: true })
  assert.equal((await routesPermit(routes, ['a', 'b'], 't1'))?.uid, 'a')
  assert.deepEqual(routes.log, ['reserve:flash'])

  const model = fakeGate({ open: true })
  assert.equal((await modelPermit(model, [null, 'wisher'], 'p1'))?.uid, 'wisher')
  assert.deepEqual(model.log, ['reserve:argon'])

  // 上限に達していれば、開いていても印を付けない（固定の応答と部品の模型に戻る）
  assert.equal(await placesPermit(fakeGate({ open: true, flash: false }), 'judge', 'w1'), undefined)
  assert.equal(await routesPermit(fakeGate({ open: true, flash: false }), ['a'], 't1'), undefined)
  assert.equal(await modelPermit(fakeGate({ open: true, argon: false }), ['a'], 'p1'), undefined)
})

test('関所の候補：重なりと空を除き、渡した順に並べる', () => {
  assert.deepEqual(budget.gateCandidates(['a', null, 'b', 'a', undefined, '', 'c']), ['a', 'b', 'c'])
  assert.deepEqual(budget.gateCandidates([]), [])
})

test('Places の確かめ：工事中になった瞬間で、まだ確かめていないピンだけを確かめる', () => {
  const after = { status: 'building', placeId: null, builtBy: 'u1' }
  assert.equal(verifyPlace.shouldVerify({ status: 'candidate' }, after), true)
  // 工事中のまま（自分が書いた位置の更新、build-model の更新）では繰り返さない
  assert.equal(verifyPlace.shouldVerify({ status: 'building' }, after), false)
  assert.equal(verifyPlace.shouldVerify({ status: 'candidate' }, { ...after, placeId: 'p' }), false)
  assert.equal(verifyPlace.shouldVerify({ status: 'candidate' }, { ...after, builtBy: null }), false)
  assert.equal(verifyPlace.shouldVerify({ status: 'candidate' }, { ...after, status: 'done' }), false)
  assert.equal(verifyPlace.shouldVerify(undefined, undefined), false)
})

test('Places の確かめ：推測の位置から遠すぎる場所は採らず、聞く文は名前と地域にする', () => {
  const hakuba = { lat: 36.698, lng: 137.862 }
  assert.equal(verifyPlace.acceptFound(hakuba, { lat: 36.70, lng: 137.85 }), true)
  assert.equal(verifyPlace.acceptFound(hakuba, { lat: 35.68, lng: 139.76 }), false, '東京の同じ名前の店に動かしてしまう')
  assert.equal(verifyPlace.placeQuery({ name: '白骨温泉', area: '長野県松本市' }), '白骨温泉 長野県松本市')
  assert.equal(verifyPlace.placeQuery({ name: '白骨温泉', area: '' }), '白骨温泉')
})

test('Places API：受け取るのは place_id と位置だけで、壊れた応答は null にする', () => {
  const body = placesApiModule.placesRequestBody('白骨温泉', { lat: 36.1, lng: 137.6 })
  assert.equal(body.textQuery, '白骨温泉')
  assert.equal(body.pageSize, 1)
  assert.deepEqual(body.locationBias.circle.center, { latitude: 36.1, longitude: 137.6 })
  assert.ok(body.locationBias.circle.radius <= 50_000, 'locationBias の半径は 50 km まで')
  assert.deepEqual(placesApiModule.parseFoundPlace({ places: [{ id: 'ChIJ1', location: { latitude: 36.1, longitude: 137.6 } }] }), {
    placeId: 'ChIJ1',
    location: { lat: 36.1, lng: 137.6 },
  })
  for (const broken of [{}, { places: [] }, { places: [{ id: '', location: { latitude: 1, longitude: 1 } }] }, { places: [{ id: 'x', location: { latitude: '1', longitude: 1 } }] }, { places: [{ id: 'x', location: { latitude: 91, longitude: 1 } }] }, null]) {
    assert.equal(placesApiModule.parseFoundPlace(broken), null, JSON.stringify(broken))
  }
  assert.equal(placesApiModule.placesApiEnabled({ PLACES_API_KEY: 'k' }), true)
  assert.equal(placesApiModule.placesApiEnabled({ PLACES_API_KEY: 'k', FUNCTIONS_EMULATOR: 'true' }), false)
  assert.equal(placesApiModule.placesApiEnabled({ PLACES_API_KEY: ' ' }), false)
  assert.equal(placesApiModule.placesApiEnabled({}), false)
})

/** verify-place の usecase 用の、ピン 1 つだけの Firestore の代わり */
function fakePinDb(pin) {
  const state = { pin: pin ? { ...pin } : undefined, writes: [] }
  const snapshot = () => ({ exists: state.pin !== undefined, data: () => state.pin })
  const ref = { get: async () => snapshot() }
  const db = {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ref }) }) }),
    runTransaction: async (fn) =>
      fn({ get: async () => snapshot(), update: (_ref, data) => (state.writes.push(data), Object.assign(state.pin, data)) }),
  }
  return { db, state }
}

function fakePlaces({ enabled = true, found = null } = {}) {
  const calls = []
  return { calls, placesApi: { enabled: () => enabled, findPlace: async (query) => (calls.push(query), found) } }
}

test('Places の確かめ：合言葉を通した人が建てたときだけ呼び、見つかれば位置と placeId だけを直す', async () => {
  const pin = { name: '白馬駅前食堂', area: '長野県白馬村', description: '説明', location: { lat: 36.6, lng: 137.8 }, placeId: null, builtBy: 'u1', status: 'building' }
  const near = { placeId: 'ChIJ_near', location: { lat: 36.698, lng: 137.862 } }

  const ok = fakePinDb(pin)
  const places = fakePlaces({ found: near })
  assert.equal(await verifyPlaceForPin({ db: ok.db, aiGate: fakeGate({ unlocked: ['u1'] }).aiGate, placesApi: places.placesApi }, 't', 'p'), 'moved')
  assert.deepEqual(places.calls, [{ text: '白馬駅前食堂 長野県白馬村', near: pin.location }])
  assert.equal(ok.state.writes.length, 1)
  assert.deepEqual(Object.keys(ok.state.writes[0]).sort(), ['location', 'placeId', 'updatedAt'], '名前や説明を Places の値で書き換えた')
  assert.equal(ok.state.pin.name, '白馬駅前食堂')

  // 全員に開く切り替えでも呼ぶ
  const open = fakePlaces({ found: near })
  assert.equal(await verifyPlaceForPin({ db: fakePinDb(pin).db, aiGate: fakeGate({ open: true }).aiGate, placesApi: open.placesApi }, 't', 'p'), 'moved')

  // 合言葉なし、キーなし（開発環境を含む）、確かめ済みでは呼ばない
  for (const [name, gate, api, given] of [
    ['合言葉なし', fakeGate(), fakePlaces({ found: near }), pin],
    ['キーなし', fakeGate({ unlocked: ['u1'] }), fakePlaces({ enabled: false, found: near }), pin],
    ['確かめ済み', fakeGate({ unlocked: ['u1'] }), fakePlaces({ found: near }), { ...pin, placeId: 'ChIJ_old' }],
  ]) {
    const db = fakePinDb(given)
    assert.equal(await verifyPlaceForPin({ db: db.db, aiGate: gate.aiGate, placesApi: api.placesApi }, 't', 'p'), 'skipped', name)
    assert.equal(api.calls.length, 0, `${name}で Places を呼んだ`)
    assert.equal(db.state.writes.length, 0, `${name}で書いた`)
  }

  // 見つからない・遠すぎるときは、位置をそのままにする
  const none = fakePinDb(pin)
  assert.equal(await verifyPlaceForPin({ db: none.db, aiGate: fakeGate({ unlocked: ['u1'] }).aiGate, placesApi: fakePlaces().placesApi }, 't', 'p'), 'not-found')
  assert.equal(none.state.writes.length, 0)
  const far = fakePinDb(pin)
  const tokyo = fakePlaces({ found: { placeId: 'ChIJ_tokyo', location: { lat: 35.68, lng: 139.76 } } })
  assert.equal(await verifyPlaceForPin({ db: far.db, aiGate: fakeGate({ unlocked: ['u1'] }).aiGate, placesApi: tokyo.placesApi }, 't', 'p'), 'too-far')
  assert.equal(far.state.writes.length, 0)
})

test('模型の入力：build-model は Places の値（placeId、位置）を読まない', () => {
  const dir = join(process.cwd(), 'functions', 'src', 'features', 'build-model')
  const sources = ['usecase.ts', 'prompt.ts', 'handler.ts']
    .map((name) => { try { return readFileSync(join(dir, name), 'utf8') } catch { return '' } })
    .join('\n')
    // 説明の文（コメント）は除く
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!/\.placeId\b|\.location\b|places-api/.test(sources), 'build-model が placeId か位置か Places を読んでいる')
})

test('口コミ：PLACES_REVIEWS=on とキーがそろうまで出さず、本文と投稿者のない口コミは除く', () => {
  assert.equal(placesApiModule.placesReviewsEnabled({ PLACES_API_KEY: 'k' }), false, '人が決める前に出してしまう')
  assert.equal(placesApiModule.placesReviewsEnabled({ PLACES_API_KEY: 'k', PLACES_REVIEWS: 'on' }), true)
  assert.equal(placesApiModule.placesReviewsEnabled({ PLACES_API_KEY: 'k', PLACES_REVIEWS: 'on', FUNCTIONS_EMULATOR: 'true' }), false)
  assert.equal(placesApiModule.placesReviewsEnabled({ PLACES_REVIEWS: 'on' }), false)
  const review = (n) => ({
    text: { text: `口コミ ${n}` },
    rating: 4,
    relativePublishTimeDescription: '1 か月前',
    authorAttribution: { displayName: `投稿者 ${n}`, uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a' },
    googleMapsUri: 'https://www.google.com/maps/reviews/1',
    flagContentUri: 'https://www.google.com/local/review/rap/report?x',
  })
  const parsed = placesApiModule.parseReviews({ reviews: [review(1), { ...review(2), text: { text: ' ' } }, { ...review(3), authorAttribution: {} }, review(4), review(5), review(6), review(7), review(8)], googleMapsUri: 'https://maps.google.com/?cid=1' })
  assert.deepEqual(parsed.reviews.map((item) => item.text), ['口コミ 1', '口コミ 4', '口コミ 5', '口コミ 6', '口コミ 7'])
  assert.equal(parsed.reviews[0].author, '投稿者 1')
  assert.equal(parsed.reviews[0].flagUri, 'https://www.google.com/local/review/rap/report?x')
  assert.equal(parsed.placeUri, 'https://maps.google.com/?cid=1')
  const odd = placesApiModule.parseReviews({ reviews: [{ ...review(1), rating: 9, googleMapsUri: 'javascript:alert(1)' }] })
  assert.equal(odd.reviews[0].rating, null)
  assert.equal(odd.reviews[0].mapsUri, null, 'https でない URL を通した')
  assert.deepEqual(placesApiModule.parseReviews(null), { reviews: [], placeUri: null, photo: null })
})

/** place-reviews の usecase 用の、メンバーとピンだけの Firestore の代わり */
function fakeReviewsDb({ member = true, pin }) {
  const doc = (exists, data) => ({ get: async () => ({ exists, data: () => data }) })
  return {
    collection: () => ({
      doc: () => ({
        collection: (name) => ({ doc: () => (name === 'members' ? doc(member, member ? {} : undefined) : doc(Boolean(pin), pin)) }),
      }),
    }),
  }
}

test('口コミ（候補のピン）：確かめていない候補は、場所の ID だけの検索で place_id を探して口コミを出す。写真は取らず、何も保存しない', async () => {
  const found = { reviews: [{ author: 'a', text: 'よかった' }], placeUri: null, photo: null }
  const calls = []
  const api = (id = 'ChIJcand') => ({
    sampleMode: () => false,
    reviewsEnabled: () => true,
    findPlaceId: async (query) => (calls.push(['find', query.text]), id),
    reviews: async (placeId, options) => (calls.push(['reviews', placeId, options]), found),
  })
  const input = { tripId: 't', pinId: 'p', uid: 'u1' }
  const candidate = { status: 'candidate', placeId: null, name: '松本城', area: '長野県松本市', location: { lat: 36.2, lng: 137.9 } }
  const unlocked = fakeGate({ unlocked: ['u1'] }).aiGate
  assert.deepEqual(await placeReviews({ db: fakeReviewsDb({ pin: candidate }), aiGate: unlocked, placesApi: api() }, input), { status: 'reviews', ...found })
  assert.deepEqual(calls, [['find', '松本城 長野県松本市'], ['reviews', 'ChIJcand', { photo: false }]])
  // 建築に失敗したピンも同じ
  calls.length = 0
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: { ...candidate, status: 'failed' } }), aiGate: unlocked, placesApi: api() }, input)).status, 'reviews')
  // 見つからなければ出さない
  calls.length = 0
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: candidate }), aiGate: unlocked, placesApi: api(null) }, input)).status, 'unavailable')
  assert.deepEqual(calls, [['find', '松本城 長野県松本市']])
  // 合言葉なし、工事中で place_id のないピンでは、探しもしない
  calls.length = 0
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: candidate }), aiGate: fakeGate().aiGate, placesApi: api() }, input)).status, 'unavailable')
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: { ...candidate, status: 'building' } }), aiGate: unlocked, placesApi: api() }, input)).status, 'unavailable')
  assert.equal(calls.length, 0, '出せないときに Places を呼んだ')
  // 建った場所でも place_id がなければ（用意した部品の模型で建った）、名前で探して写真も取る（しおりの再生、#279）
  calls.length = 0
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: { ...candidate, status: 'done' } }), aiGate: unlocked, placesApi: api() }, input)).status, 'reviews')
  assert.deepEqual(calls, [['find', '松本城 長野県松本市'], ['reviews', 'ChIJcand', { photo: true }]])
  calls.length = 0
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: { ...candidate, status: 'done' } }), aiGate: fakeGate().aiGate, placesApi: api() }, input)).status, 'unavailable', '見る人が合言葉を通していないのに探した')
  assert.equal(calls.length, 0)
  // 確かめた場所（場所の情報）では探さず、写真も取ってよい
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: { ...candidate, status: 'done', placeId: 'ChIJ1' } }), aiGate: unlocked, placesApi: api() }, input)).status, 'reviews')
  assert.deepEqual(calls, [['reviews', 'ChIJ1', { photo: true }]])
  // ID だけの検索の応答の読み方
  assert.equal(placesApiModule.parseFoundPlaceId({ places: [{ id: 'ChIJ_x-1' }] }), 'ChIJ_x-1')
  assert.equal(placesApiModule.parseFoundPlaceId({ places: [] }), null)
  assert.equal(placesApiModule.parseFoundPlaceId({ places: [{ id: '../x' }] }), null)
  assert.equal(placesApiModule.parseFoundPlaceId(null), null)
})

test('口コミ（開発環境）：Emulator では Places を呼ばず、合言葉なしでも見本の口コミを返す。写真は建った場所だけ', async () => {
  const calls = []
  const api = { sampleMode: () => true, reviewsEnabled: () => false, findPlaceId: async () => (calls.push('find'), null), reviews: async () => (calls.push('reviews'), null) }
  const input = { tripId: 't', pinId: 'p', uid: 'u1' }
  const done = await placeReviews({ db: fakeReviewsDb({ pin: { status: 'done', placeId: null, name: '松本城' } }), aiGate: fakeGate().aiGate, placesApi: api }, input)
  assert.equal(done.status, 'reviews')
  assert.equal(done.reviews.length, 3)
  assert.ok(done.reviews.every((review) => review.author.includes('開発用') && review.text.startsWith('【開発用の見本】')), '見本と分からない')
  assert.equal(done.photo.uri, reviewsLogic.SAMPLE_PHOTO_PATH)
  assert.equal(done.sample, true, '見本の印がない（画面が Google マップの出典を出してしまう）')
  assert.deepEqual(done.photo.authors, [])
  const candidate = await placeReviews({ db: fakeReviewsDb({ pin: { status: 'candidate', placeId: null, name: '松本城' } }), aiGate: fakeGate().aiGate, placesApi: api }, input)
  assert.equal(candidate.photo, null, '候補のカードに写真を付けた')
  assert.deepEqual(calls, [], '開発環境で Places を呼んだ')
  // メンバーでない人には返さない
  assert.equal((await placeReviews({ db: fakeReviewsDb({ member: false, pin: { status: 'done' } }), aiGate: fakeGate().aiGate, placesApi: api }, input)).status, 'not-member')
  assert.equal(placesApiModule.placesSampleMode({ FUNCTIONS_EMULATOR: 'true' }), true)
  assert.equal(placesApiModule.placesSampleMode({}), false)
})

test('写真：口コミを出せる設定に PLACES_PHOTOS=on がそろうまで聞かず、1 枚目の写真と撮った人を取り出す', () => {
  const on = { PLACES_API_KEY: 'k', PLACES_REVIEWS: 'on' }
  assert.equal(placesApiModule.placesPhotosEnabled(on), false, '人が上限を上げる前に写真を聞いてしまう')
  assert.equal(placesApiModule.placesPhotosEnabled({ ...on, PLACES_PHOTOS: 'on' }), true)
  assert.equal(placesApiModule.placesPhotosEnabled({ PLACES_API_KEY: 'k', PLACES_PHOTOS: 'on' }), false, '口コミを出さない設定では写真も出さない')
  assert.equal(placesApiModule.placesPhotosEnabled({ ...on, PLACES_PHOTOS: 'on', FUNCTIONS_EMULATOR: 'true' }), false)

  const first = placesApiModule.parseFirstPhoto({
    photos: [
      { name: 'places/ChIJabc/photos/AXyz_1', authorAttributions: [{ displayName: ' 山田 ', uri: 'https://maps.google.com/contrib/1' }, { displayName: '', uri: 'https://x' }, { displayName: '鈴木', uri: 'javascript:1' }] },
      { name: 'places/ChIJabc/photos/second' },
    ],
  })
  assert.deepEqual(first, { name: 'places/ChIJabc/photos/AXyz_1', authors: [{ name: '山田', uri: 'https://maps.google.com/contrib/1' }, { name: '鈴木', uri: null }] })
  // 写真がない、名前の形が違う（ほかの URL に送らない）なら null
  assert.equal(placesApiModule.parseFirstPhoto({ photos: [] }), null)
  assert.equal(placesApiModule.parseFirstPhoto({}), null)
  assert.equal(placesApiModule.parseFirstPhoto({ photos: [{ name: '../../evil' }] }), null)
  assert.equal(placesApiModule.parsePhotoUri({ photoUri: 'https://lh3.googleusercontent.com/p/abc=w800' }), 'https://lh3.googleusercontent.com/p/abc=w800')
  assert.equal(placesApiModule.parsePhotoUri({ photoUri: 'http://x' }), null)
  assert.equal(placesApiModule.parsePhotoUri(null), null)
})

test('口コミ：メンバーで、合言葉を通していて、確かめた場所のときだけ聞き、保存せずに返す', async () => {
  const found = { reviews: [{ author: 'a', text: 'よかった' }], placeUri: null }
  const calls = []
  const api = (enabled = true) => ({ sampleMode: () => false, reviewsEnabled: () => enabled, reviews: async (id) => (calls.push(id), found) })
  const pin = { placeId: 'ChIJ1', name: '善光寺' }
  const input = { tripId: 't', pinId: 'p', uid: 'u1' }
  assert.deepEqual(await placeReviews({ db: fakeReviewsDb({ pin }), aiGate: fakeGate({ unlocked: ['u1'] }).aiGate, placesApi: api() }, input), { status: 'reviews', ...found })
  assert.deepEqual(calls, ['ChIJ1'])
  calls.length = 0
  for (const [name, ports] of [
    ['人が決める前', { db: fakeReviewsDb({ pin }), aiGate: fakeGate({ unlocked: ['u1'] }).aiGate, placesApi: api(false) }],
    ['合言葉なし', { db: fakeReviewsDb({ pin }), aiGate: fakeGate().aiGate, placesApi: api() }],
    ['全員に開く切り替えだけ', { db: fakeReviewsDb({ pin }), aiGate: fakeGate({ open: true }).aiGate, placesApi: api() }],
    ['確かめていない場所', { db: fakeReviewsDb({ pin: { ...pin, placeId: null } }), aiGate: fakeGate({ unlocked: ['u1'] }).aiGate, placesApi: api() }],
  ]) {
    assert.equal((await placeReviews(ports, input)).status, 'unavailable', name)
  }
  assert.equal(calls.length, 0, '出せないときに Places を呼んだ')
  assert.equal((await placeReviews({ db: fakeReviewsDb({ member: false, pin }), aiGate: fakeGate().aiGate, placesApi: api() }, input)).status, 'not-member')
  assert.equal((await placeReviews({ db: fakeReviewsDb({ pin: undefined }), aiGate: fakeGate().aiGate, placesApi: api() }, input)).status, 'not-found')
})

test('Knowledge Graph：Creative Commons（BY-SA）の詳しい説明だけを使い、長い説明は切る', () => {
  const ok = { itemListElement: [{ result: { name: '善光寺', description: '寺院', detailedDescription: { articleBody: '善光寺は、長野県長野市にある無宗派の単立寺院。', url: 'https://ja.wikipedia.org/wiki/%E5%96%84%E5%85%89%E5%AF%BA', license: 'https://creativecommons.org/licenses/by-sa/3.0/' } } }] }
  assert.deepEqual(kg.parseReference(ok), {
    text: '善光寺は、長野県長野市にある無宗派の単立寺院。',
    url: 'https://ja.wikipedia.org/wiki/%E5%96%84%E5%85%89%E5%AF%BA',
    license: 'https://creativecommons.org/licenses/by-sa/3.0/',
  })
  const long = structuredClone(ok)
  long.itemListElement[0].result.detailedDescription.articleBody = 'あ'.repeat(kg.MAX_REFERENCE_CHARS + 50)
  assert.equal(kg.parseReference(long).text.length, kg.MAX_REFERENCE_CHARS + 1)
  // ライセンスが示されていない（短い description だけ）、CC BY-SA でない、URL が https でないものは使わない
  const noDetail = { itemListElement: [{ result: { name: '善光寺', description: '寺院' } }] }
  const otherLicense = structuredClone(ok)
  otherLicense.itemListElement[0].result.detailedDescription.license = 'https://example.com/terms'
  const http = structuredClone(ok)
  http.itemListElement[0].result.detailedDescription.url = 'http://ja.wikipedia.org/wiki/x'
  // Knowledge Graph がふだん返す形：Wikipedia のライセンスの説明のページ
  const wikiLicense = structuredClone(ok)
  wikiLicense.itemListElement[0].result.detailedDescription.license = 'https://en.wikipedia.org/wiki/Wikipedia:Text_of_Creative_Commons_Attribution-ShareAlike_3.0_Unported_License'
  assert.equal(kg.parseReference(wikiLicense)?.license, 'https://en.wikipedia.org/wiki/Wikipedia:Text_of_Creative_Commons_Attribution-ShareAlike_3.0_Unported_License')
  assert.equal(kg.isCcBySa('https://evil.example/wiki/Wikipedia:Text_of_Creative_Commons_Attribution-ShareAlike'), false)
  assert.equal(kg.isCcBySa('http://creativecommons.org/licenses/by-sa/3.0/'), false)
  const warn = console.warn
  console.warn = () => {}
  try {
    for (const broken of [noDetail, otherLicense, http, { itemListElement: [] }, {}, null]) assert.equal(kg.parseReference(broken), null)
  } finally {
    console.warn = warn
  }
  assert.equal(kg.kgSearchParams('善光寺').get('key'), null, 'URL にキーを入れたまま返している')
  assert.equal(kg.kgSearchParams('善光寺').get('languages'), 'ja')
  assert.equal(kg.knowledgeGraphEnabled({ KG_API_KEY: 'k' }), true)
  assert.equal(kg.knowledgeGraphEnabled({ KG_API_KEY: 'k', FUNCTIONS_EMULATOR: 'true' }), false)
  assert.equal(kg.knowledgeGraphEnabled({}), false)
})

test('模型の指示：参考の説明があるときだけ足す', () => {
  const base = { name: '善光寺', description: '長野の古いお寺', wishText: 'お参りしたい', category: 'shrine' }
  assert.ok(!buildModelTask.prompt(base).includes('参考'))
  assert.ok(buildModelTask.prompt({ ...base, reference: '善光寺は無宗派の寺院。' }).includes('善光寺は無宗派の寺院。'))
})

process.on('exit', () => {
  console.warn = originalWarn
})
