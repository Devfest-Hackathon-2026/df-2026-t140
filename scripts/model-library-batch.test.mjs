import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { validateEntries, MAX_LIBRARY_ENTRIES } from './model-library.mjs'
import { MAX_PER_CALL, MODEL_GENERATORS, PREFECTURES, TARGET_PER_PREFECTURE, VIEW_RULE, assertAvailableModel, batchModelEntries, batchModelPrompt, mergeModels, pendingCandidates, validateCandidates } from './model-library-batch.mjs'

const require = createRequire(import.meta.url)
const { findAgy } = require('../functions/lib/adapters/gemini/agy.js')
const { modelKey } = require('../functions/lib/features/build-model/logic/library.js')
const { PREBUILT_MODELS } = require('../functions/lib/features/build-model/logic/prebuilt.js')
const { CATALOGUE } = require('../functions/lib/features/suggest-places/logic/catalogue.js')
const identity = { name: '確認用の場所', area: '長野県松本市', category: 'onsen', description: '確認用' }
const model = { source: 'argon', json: { version: 1, parts: [{ shape: 'box', size: [10, 0.6, 10], position: [0, 0, 0], color: '#aabbcc' }] } }
const value = (name) => ({ provider: 'agy', identity: { ...identity, name }, model })

test('全国47都道府県に各100件の目標があり、見本の一覧の151件を含めて辞書を保持する', () => {
  assert.equal(new Set(PREFECTURES).size, 47)
  assert.equal(PREFECTURES.length * TARGET_PER_PREFECTURE, 4700)
  const base = PREBUILT_MODELS.map((entry) => ({ provider: 'agy', identity: entry.identity, model: entry.model }))
  const merged = mergeModels(base, [])
  assert.equal(CATALOGUE.length, 151)
  assert.equal(merged.length, PREBUILT_MODELS.length)
  assert.ok(PREBUILT_MODELS.length >= CATALOGUE.length)
  assert.deepEqual(validateEntries(merged), PREBUILT_MODELS)
  assert.deepEqual(pendingCandidates(CATALOGUE.map((item) => ({ ...item, area: item.pref + item.city })), PREBUILT_MODELS), [])
})

test('4700件を検証でき、上限・不正模型・代替模型・別providerは拒否する', () => {
  assert.equal(validateEntries(Array.from({ length: 4700 }, (_, index) => value(`確認${index}`))).length, 4700)
  assert.throws(() => validateEntries(Array(MAX_LIBRARY_ENTRIES + 1)), /5000/u)
  assert.throws(() => validateEntries([{ ...value('a'), provider: 'vertex' }]), /agy/u)
  assert.throws(() => validateEntries([{ ...value('a'), model: { ...model, source: 'parts' } }]))
  assert.throws(() => validateEntries([{ ...value('a'), model: { ...model, json: { version: 1, parts: [] } } }]))
})

test('統合は既存模型の上書きと正規化後の重複を拒否し、出典を保持する', () => {
  const original = value('A')
  original.model = { ...model, reference: { text: '確認用', url: 'https://example.com', license: 'CC BY-SA' } }
  assert.throws(() => mergeModels([original], [value('Ａ')]), /上書き/u)
  assert.throws(() => validateEntries([value('A'), value(' Ａ ')]), /重複/u)
  const merged = mergeModels([original], [value('B')])
  assert.equal(merged.length, 2)
  assert.deepEqual(merged[0].model.reference, original.model.reference)
})

test('再開では成功したキーだけをスキップする', () => {
  const a = { ...identity, name: 'a' }
  const b = { ...identity, name: 'b' }
  assert.deepEqual(pendingCandidates([a, b], [{ key: modelKey(a) }]), [b])
})

test('候補は対象県と種類を検証し、同じ場所を違う種類で水増ししない', () => {
  assert.deepEqual(validateCandidates([identity], '長野県'), [identity])
  for (const invalid of [{ ...identity, area: '東京都' }, { ...identity, category: 'other' }, { ...identity, description: '' }]) {
    assert.throws(() => validateCandidates([invalid], '長野県'))
  }
  assert.throws(() => validateCandidates([identity, { ...identity, category: 'town' }], '長野県'), /重複/u)
  assert.throws(() => validateCandidates([identity], '長野県', [identity]), /重複/u)
})

test('まとめて作るときは、全件の名前と説明、1件ずつと同じ形の指示、向きの指示を並べ、件数を守る', () => {
  const items = ['a', 'b', 'c'].map((name) => ({ ...identity, name, description: `${name}の説明` }))
  const prompt = batchModelPrompt(items)
  for (const item of items) assert.ok(prompt.includes(JSON.stringify(item.name)) && prompt.includes(JSON.stringify(item.description)))
  assert.ok(prompt.includes('"version": 1') && prompt.includes(VIEW_RULE) && prompt.includes('3 個の模型 JSON'))
  assert.throws(() => batchModelPrompt([]))
  assert.throws(() => batchModelPrompt(Array.from({ length: MAX_PER_CALL + 1 }, () => identity)))
})

test('まとめて作った配列は順番どおりに1件ずつ検査し、崩れた件だけを捨てる', () => {
  const items = ['a', 'b', 'c'].map((name) => ({ ...identity, name }))
  const entries = batchModelEntries(items, [model.json, { version: 1, parts: [] }, model.json])
  assert.deepEqual(entries.map((entry) => entry?.identity.name ?? null), ['a', null, 'c'])
  assert.deepEqual(batchModelEntries(items, { not: 'array' }), [null, null, null])
})

test('模型はArgonか、明示したときだけHydrogenで作り、Flashでは作らない', () => {
  assert.deepEqual(MODEL_GENERATORS, ['gemini-4-argon-medium', 'gemini-4-hydrogen-medium'])
  assert.ok(!MODEL_GENERATORS.some((name) => name.includes('flash')))
})

test('Argonが一覧にないと止まり、Flashで代用しない', () => {
  assert.throws(() => assertAvailableModel('Fetching models...\ngemini-3.8-flash-high\tFlash\n', 'gemini-4-argon-medium'), /別モデルには/u)
  assert.doesNotThrow(() => assertAvailableModel('gemini-4-argon-medium\tArgon\r\n', 'gemini-4-argon-medium'))
})

test('既定の計画表示はagyがなくても動き、既存模型は生成対象にならない', () => {
  const env = { ...process.env, AGY_BIN: join(tmpdir(), 'missing-agy-konbu') }
  const output = execFileSync(process.execPath, ['scripts/model-library-batch.mjs', 'generate', '--prefecture', '長野県'], { encoding: 'utf8', env })
  assert.match(output, /未生成0件/u)
  assert.match(output, /計画表示のみ/u)
})

test('agyの明示パスを優先し、Windowsの公式配置とPATHの.exeを見つける', () => {
  const dir = mkdtempSync(join(tmpdir(), 'konbu-agy-path-'))
  try {
    const exe = join(dir, process.platform === 'win32' ? 'agy.exe' : 'agy')
    writeFileSync(exe, '', { mode: 0o755 })
    assert.equal(findAgy({ AGY_BIN: exe, PATH: '' }), exe)
    assert.equal(findAgy({ AGY_BIN: join(dir, 'missing'), PATH: dir }), null)
    assert.equal(findAgy({ PATH: dir, HOME: dir, USERPROFILE: dir }), exe)
    if (process.platform === 'win32') {
      mkdirSync(join(dir, 'agy', 'bin'), { recursive: true })
      const official = join(dir, 'agy', 'bin', 'agy.exe')
      writeFileSync(official, '')
      assert.equal(findAgy({ PATH: '', LOCALAPPDATA: dir }), official)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
