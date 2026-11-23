// 同じ場所を旅の中で何度も訪れる決め（functions/src/domain/visit.ts、features/repeat-visit と、行の ID を使うほかの処理）を、
// Emulator なしで確かめる。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const visit = require('../functions/lib/domain/visit.js')
const { routeWithVisitAdded, routeWithVisitRemoved } = require('../functions/lib/features/repeat-visit/logic.js')
const { moveStop } = require('../functions/lib/features/reorder-shiori/logic.js')
const { routeAfterRemoval } = require('../functions/lib/features/remove-building/logic.js')
const { routeWithStopTime } = require('../functions/lib/features/set-stop-time/logic.js')
const { routeWithLegMode } = require('../functions/lib/features/change-leg-mode/logic.js')
const { routeWithMode } = require('../functions/lib/features/change-travel-mode/logic.js')
const { addToDecidedRoute } = require('../functions/lib/features/propose-routes/logic.js')
const { routeOrder } = require('../functions/lib/features/shiori-travel/logic.js')

// 車で、近い 3 か所（東京駅から）。スキー場に 2 日続けて行き、宿に毎晩戻る旅を組む
const ORIGIN = { name: '東京駅', location: { lat: 35.6812, lng: 139.7671 }, travelMode: 'car' }
const SKI = { id: 'ski', name: 'スキー場', location: { lat: 36.7, lng: 137.83 }, uid: 'u1' }
const INN = { id: 'inn', name: '宿', location: { lat: 36.69, lng: 137.86 }, uid: 'u2' }
const SOBA = { id: 'soba', name: 'そば', location: { lat: 36.74, lng: 138.08 }, uid: 'u3' }
const PLACES = [SKI, INN, SOBA]
const base = { style: 'shortest', pinIds: ['ski', 'inn', 'soba'], revision: 1 }
const rows = (update) => update.schedule.filter((stop) => stop.pinId).map((stop) => [stop.day, stop.stopId ?? stop.pinId, stop.pinId])

test('行の ID：ピンの ID を取り出し、次の番号を決め、形を確かめる', () => {
  assert.equal(visit.pinOfStop('ski'), 'ski')
  assert.equal(visit.pinOfStop('ski~3'), 'ski')
  assert.equal(visit.nextStopId(['ski', 'inn'], 'ski'), 'ski~2')
  // 空いているいちばん小さい番号を使う（足す・消すをくり返しても、番号が 3 けたを超えない）
  assert.equal(visit.nextStopId(['ski', 'ski~4', 'inn'], 'ski'), 'ski~2')
  assert.equal(visit.nextStopId(['ski~3', 'ski~2', 'inn~2'], 'ski'), 'ski~4')
  assert.ok(visit.STOP_ID.test('AbC123xyz'))
  assert.ok(visit.STOP_ID.test('AbC123xyz~2'))
  for (const bad of ['', '@origin', 'a~', 'a~0', 'a~b', 'a~2~3', 'a>b']) assert.equal(visit.STOP_ID.test(bad), false, bad)
})

test('行の ID：しおりの順に場所を並べる。複製した行は同じ場所で、建っていない場所の行は飛ばす', () => {
  const order = visit.visitOrder(['ski', 'inn', 'ski~2', 'gone', 'gone~2'], PLACES)
  assert.deepEqual(order.map((place) => [place.id, place.pinId, place.name]), [['ski', undefined, 'スキー場'], ['inn', undefined, '宿'], ['ski~2', 'ski', 'スキー場']])
  assert.deepEqual(routeOrder({ pinIds: ['inn', 'inn~2'] }, PLACES).map((place) => place.id), ['inn', 'inn~2'])
})

test('行の複製（repeatVisit）：すぐ下に同じ場所の行が増え、時刻と日を計算し直す', () => {
  const update = routeWithVisitAdded(base, PLACES, ORIGIN, 2, 'ski')
  assert.deepEqual(update.pinIds, ['ski', 'ski~2', 'inn', 'soba'])
  assert.equal(update.revision, 2)
  // 行の pinId はピンの ID のまま。複製した行にだけ stopId が付く。どの行も 1 日目の 19 時までに入るので、1 日目にまとまる（#520）
  assert.deepEqual(rows(update), [[1, 'ski', 'ski'], [1, 'ski~2', 'ski'], [1, 'inn', 'inn'], [1, 'soba', 'soba']])
  assert.equal(update.schedule[1].stopId, undefined)
  assert.equal(update.schedule[2].stopId, 'ski~2')
  assert.equal(update.schedule[2].name, 'スキー場')
  // もう 1 回複製すると、次の番号になる
  const again = routeWithVisitAdded({ ...base, ...update }, PLACES, ORIGIN, 2, 'ski~2')
  assert.deepEqual(again.pinIds, ['ski', 'ski~2', 'ski~3', 'inn', 'soba'])
  // しおりにない行は stale
  assert.equal(routeWithVisitAdded(base, PLACES, ORIGIN, 2, 'ski~2'), 'stale')
  assert.equal(routeWithVisitAdded(base, [INN, SOBA], ORIGIN, 2, 'ski'), 'stale')
})

test('行の複製（repeatVisit）：上限の行の数では足せない', () => {
  const pinIds = ['ski', ...Array.from({ length: visit.MAX_STOPS - 1 }, (_, index) => `ski~${index + 2}`)]
  assert.equal(routeWithVisitAdded({ ...base, pinIds }, PLACES, ORIGIN, 2, 'ski'), 'full')
})

test('行の複製（repeatVisit）：人が直した時刻は残り、次の場所への区間の手段は、足した行からの区間に引き継ぐ', () => {
  const route = { ...base, stopTimes: { inn: 15 * 60 }, legModes: { 'ski>inn': 'walk', '@origin>ski': 'transit' } }
  const update = routeWithVisitAdded(route, PLACES, ORIGIN, 1, 'ski')
  assert.deepEqual(update.stopTimes, { inn: 15 * 60 })
  assert.deepEqual(update.legModes, { '@origin>ski': 'transit', 'ski~2>inn': 'walk' })
  assert.equal(update.schedule.find((stop) => stop.pinId === 'inn').time, '15:00')
})

test('行を消す（repeatVisit）：その行だけが消え、最後の 1 行は消せない', () => {
  const route = { ...base, pinIds: ['ski', 'inn', 'ski~2', 'soba'], stopTimes: { 'ski~2': 13 * 60, soba: 16 * 60 }, legModes: { 'inn>ski~2': 'walk' } }
  const update = routeWithVisitRemoved(route, PLACES, ORIGIN, 1, 'ski~2')
  assert.deepEqual(update.pinIds, ['ski', 'inn', 'soba'])
  assert.deepEqual(update.stopTimes, { soba: 16 * 60 })
  assert.deepEqual(update.legModes, {})
  assert.equal(routeWithVisitRemoved(route, PLACES, ORIGIN, 1, 'inn'), 'last')
  assert.equal(routeWithVisitRemoved(route, PLACES, ORIGIN, 1, 'ski~9'), 'stale')
})

test('行を消す（repeatVisit）：ピンの ID の行を消すと、残りの先頭の行をピンの ID に付け替え、その行の時刻と区間の選択を引き継ぐ', () => {
  const route = {
    ...base,
    pinIds: ['ski', 'inn', 'ski~2', 'soba', 'ski~3'],
    stopTimes: { ski: 10 * 60, 'ski@leave': 11 * 60, 'ski~2': 13 * 60, 'ski~2@leave': 14 * 60 },
    legModes: { 'ski>inn': 'walk', 'inn>ski~2': 'walk', 'ski~2>soba': 'transit' },
  }
  const update = routeWithVisitRemoved(route, PLACES, ORIGIN, 1, 'ski')
  assert.deepEqual(update.pinIds, ['inn', 'ski', 'soba', 'ski~3'])
  // 出る時刻（行の ID@leave）も、行といっしょに外れ・付け替わる
  assert.deepEqual(update.stopTimes, { ski: 13 * 60, 'ski@leave': 14 * 60 })
  assert.deepEqual(update.legModes, { 'inn>ski': 'walk', 'ski>soba': 'transit' })
  assert.deepEqual(rows(update), [[1, 'inn', 'inn'], [1, 'ski', 'ski'], [1, 'soba', 'soba'], [1, 'ski~3', 'ski']])
  assert.equal(update.schedule.find((stop) => stop.pinId === 'ski').time, '13:00')
})

test('同じ場所が 2 回あるしおり：行の移動、時刻、区間の手段、旅全体の手段が、行の ID で動く', () => {
  const route = { ...base, pinIds: ['ski', 'ski~2', 'inn', 'soba'] }
  // 複製した行を取って、そばの行に落とす（スキー場 → 宿 → そば → スキー場。あいだの行は 1 つずつ上へずれる）
  const swapped = moveStop(route, PLACES, ORIGIN, 2, 'ski~2', 'soba')
  assert.deepEqual(swapped.pinIds, ['ski', 'inn', 'soba', 'ski~2'])
  // スキー場は 16 時までいるので、そばは 2 日目に回る（#602）
  assert.deepEqual(rows(swapped), [[1, 'ski', 'ski'], [1, 'inn', 'inn'], [2, 'soba', 'soba'], [2, 'ski~2', 'ski']])
  // 2 回目の行の着く時刻だけを直す（1 回目の行は変わらない）
  const order = visit.visitOrder(swapped.pinIds, PLACES)
  const timed = routeWithStopTime({ ...route, ...swapped }, order, ORIGIN, 2, 'ski~2', 14 * 60)
  assert.deepEqual(timed.stopTimes, { 'ski~2': 14 * 60 })
  assert.equal(timed.schedule.find((stop) => stop.stopId === 'ski~2').time, '14:00')
  assert.equal(timed.schedule.find((stop) => stop.pinId === 'ski' && !stop.stopId).time, swapped.schedule.find((stop) => stop.pinId === 'ski' && !stop.stopId).time)
  // 宿 → そば の区間だけ電車・バスにする。2 回目のスキー場への区間は、行の ID で指す
  const walked = routeWithLegMode({ ...route, ...swapped }, order, ORIGIN, 2, 'soba', 'ski~2', 'transit')
  assert.deepEqual(walked.legModes, { 'soba>ski~2': 'transit' })
  assert.equal(routeWithLegMode({ ...route, ...swapped }, order, ORIGIN, 2, 'inn', 'ski', 'walk'), 'stale')
  // 旅全体の手段を切り替えても、行は保つ
  const pins = PLACES.map((place) => ({ ...place }))
  assert.deepEqual(rows(routeWithMode({ ...route, ...swapped }, pins, { ...ORIGIN, travelMode: 'transit' }, 2)).map((row) => row[1]), ['ski', 'inn', 'soba', 'ski~2'])
})

test('同じ場所が 2 回あるしおり：となり合う同じ場所の区間は 0 km で、時刻が進む', () => {
  const update = routeWithVisitAdded(base, PLACES, ORIGIN, 1, 'ski')
  const first = update.schedule.find((stop) => stop.pinId === 'ski' && !stop.stopId)
  const second = update.schedule.find((stop) => stop.stopId === 'ski~2')
  assert.ok(Number.isFinite(first.moveMinutesToNext) && first.moveMinutesToNext >= 0)
  assert.ok(second.time > first.time)
  // 電車・バスの旅でも見積もれる
  const transit = routeWithVisitAdded(base, PLACES, { ...ORIGIN, travelMode: 'transit' }, 1, 'ski')
  assert.ok(Number.isFinite(transit.schedule.find((stop) => stop.pinId === 'ski' && !stop.stopId).moveMinutesToNext))
})

test('同じ場所が 2 回あるしおり：建物を消すと、その場所の行がすべて消える。あとから建った場所を足しても、行は保つ', () => {
  const route = { ...base, pinIds: ['ski', 'inn', 'ski~2'], addedPinIds: [] }
  const removed = routeAfterRemoval(route, [INN], ORIGIN, 1, 'ski', true)
  assert.deepEqual(removed.update.pinIds, ['inn'])
  // 最後の場所の行（複製を含む）を消したら、計画中のしおりは消す
  assert.deepEqual(routeAfterRemoval({ ...route, pinIds: ['ski', 'ski~2'] }, [], ORIGIN, 1, 'ski', true), { kind: 'delete' })
  // そばが建った：スキー場は足さず（もう入っている）、そばだけが入る
  // 2 日の旅で足す（日帰りにスキー場 2 回と宿とそばは時間に収まらず、足すと場所が外れるため。#622）
  const added = addToDecidedRoute(route, PLACES, ORIGIN, 2)
  assert.deepEqual([...added.pinIds].sort(), ['inn', 'ski', 'ski~2', 'soba'])
  assert.deepEqual(added.addedPinIds, ['soba'])
  assert.equal(addToDecidedRoute({ ...route, pinIds: added.pinIds }, PLACES, ORIGIN, 1), null)
})
