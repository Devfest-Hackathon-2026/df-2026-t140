import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { originName, routeWithOrigin } = require('../functions/lib/features/resolve-origin/logic.js')
const { knownOriginLocation } = require('../functions/lib/domain/originPlaces.js')
const { tripOrigin } = require('../functions/lib/domain/tripOrigin.js')
const { modelKey, libraryEntry, readLibraryEntry } = require('../functions/lib/features/build-model/logic/library.js')
const { prefabFor } = require('../functions/lib/features/build-model/logic/prefabs.js')

test('出発地：空・長すぎる名前を拒否し、目黒・めぐろを解決する', () => {
  assert.equal(originName('  目黒駅  '), '目黒駅')
  for (const value of [null, 7, ' ', 'あ'.repeat(41)]) assert.equal(originName(value), null)
  for (const name of ['目黒', 'めぐろ', '目黒駅']) assert.deepEqual(knownOriginLocation(name), { lat: 35.6339, lng: 139.7158 })
})

test('出発地：表にない住所を、住所の一部に含まれる東京へ置き換えない', () => {
  assert.equal(knownOriginLocation('東京都世田谷区の待ち合わせ場所'), null)
  assert.equal(knownOriginLocation('会津若松'), null)
  assert.deepEqual(knownOriginLocation('東京駅'), { lat: 35.68, lng: 139.77 })
})

test('出発地：名前の違う保存済み位置を使わず、以前の旅にも対応する', () => {
  const point = { name: '目黒', location: { lat: 35.6339, lng: 139.7158 }, placeId: null }
  assert.deepEqual(tripOrigin({ origin: '目黒', originPoint: point }).location, point.location)
  assert.deepEqual(tripOrigin({ origin: '大阪駅', originPoint: point }).location, { lat: 34.7, lng: 135.5 })
  assert.equal(tripOrigin({ origin: 'うちの前', originPoint: point }).location, null)
})

test('出発地：変更で訪問順を保ち、集合場所と移動時間を計算し直す', () => {
  const route = { pinIds: ['b', 'a'], style: 'shortest', revision: 2 }
  const pins = [
    { id: 'a', name: '場所A', location: { lat: 36, lng: 138 }, uid: 'u' },
    { id: 'b', name: '場所B', location: { lat: 36.2, lng: 138.1 }, uid: 'u' },
  ]
  const changed = routeWithOrigin(route, pins, { name: '目黒', location: { lat: 35.6339, lng: 139.7158 } }, 1)
  assert.deepEqual(changed.schedule.filter((stop) => stop.pinId).map((stop) => stop.pinId), ['b', 'a'])
  assert.equal(changed.schedule[0].name, '目黒 出発')
  assert.ok(changed.totalMoveMinutes > 0)
  assert.equal(changed.revision, 3)
  assert.deepEqual(route.pinIds, ['b', 'a'])
})

test('模型辞書：場所と版を照合し、出典を保持する。不正な模型と代替模型を共有しない', () => {
  const identity = { name: '白骨温泉', area: '長野県松本市', category: 'onsen' }
  const model = { json: prefabFor('onsen'), source: 'argon', reference: { text: '検証用', url: 'https://example.com/reference', license: 'CC BY-SA' } }
  const entry = libraryEntry(identity, model)
  assert.deepEqual(readLibraryEntry(entry, identity), model)
  assert.equal(modelKey({ ...identity, area: '' }), null)
  assert.equal(modelKey(null), null)
  assert.notEqual(modelKey(identity), modelKey({ ...identity, area: '別の県' }))
  assert.equal(readLibraryEntry(entry, { ...identity, name: '別の温泉' }), null)
  assert.equal(readLibraryEntry({ ...entry, version: 0 }, identity), null)
  assert.equal(readLibraryEntry({ ...entry, model: { ...model, json: { version: 1, parts: [] } } }, identity), null)
  assert.equal(libraryEntry(identity, { ...model, source: 'parts' }), null)
  assert.equal(libraryEntry(identity, null), null)
})
