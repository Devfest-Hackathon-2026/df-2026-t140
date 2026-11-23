// 時刻が決まったイベント（花火大会、見学会。#581）の決めを、Emulator なしで確かめる。
// 探す（features/suggest-places/logic/events.ts）、しおりに固定する（domain/routePlan.ts の buildPlan、dayPacker）、
// 差し込む位置を選ぶ（eventAwareIndex、settleEvents）、人が直すときに確かめる（features/set-stop-time/logic.ts）、動かせない（reorder-shiori）。
// scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { buildPlan, eventAwareIndex, eventClashes, eventShortfall, insertionIndex, planPlace, settleEvents, STYLE_TIMINGS } = require(
  '../functions/lib/domain/routePlan.js',
)
const { eventBufferMinutes, eventWindow, isPinEvent } = require('../functions/lib/domain/event.js')
const { tripOrigin } = require('../functions/lib/domain/tripOrigin.js')
const { EVENT_CATALOGUE, EVENT_SOURCE, searchEvents, wantsEvent } = require('../functions/lib/features/suggest-places/logic/events.js')
const { clashesWith, isEventTime, newClashes, routeWithStopTime } = require('../functions/lib/features/set-stop-time/logic.js')
const { moveStop } = require('../functions/lib/features/reorder-shiori/logic.js')

// 2026-11-27 は金曜、2026-11-28 は土曜（花火の見本は土曜の夜）
const FRIDAY = '2026-11-27'
const SATURDAY = '2026-11-28'
const ORIGIN = { name: '松本駅', location: { lat: 36.2308, lng: 137.9644 }, travelMode: 'car', startDate: FRIDAY }
const at = (id, lat, lng, category) => ({ id, name: id, location: { lat, lng }, uid: 'u1', category })
const CASTLE = at('castle', 36.2386, 137.9689, 'shrine')
const SOBA = at('soba', 36.235, 137.97, 'food')
const SKI = at('ski', 36.7, 137.83, 'ski')
const FIREWORKS_EVENT = { kind: 'fireworks', date: SATURDAY, start: 19 * 60 + 30, end: 20 * 60 + 30, leadMinutes: 60, source: '見本' }
// 諏訪の花火（2 日目の土曜、19:30〜20:30。1 時間前の 18:30 に着く）
const FIREWORKS = { ...at('fireworks', 36.05, 138.09, 'nightview'), event: FIREWORKS_EVENT }
const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const rowOf = (plan, id) => plan.schedule.find((stop) => stop.pinId === id)
const checksOf = (order, origin, days, timing = STYLE_TIMINGS.shortest) => {
  const checks = []
  buildPlan(order, origin, days, timing, undefined, undefined, undefined, checks)
  return checks
}

test('見分ける：花火は花火大会、見学会・工場見学は見学会、「イベント」だけなら両方。ほかは null', () => {
  assert.deepEqual(wantsEvent('花火がみたい'), ['fireworks'])
  assert.deepEqual(wantsEvent('工場見学に行きたい'), ['tour'])
  assert.deepEqual(wantsEvent('何かイベントに行きたい'), ['fireworks', 'tour'])
  assert.equal(wantsEvent('温泉に入りたい'), null)
})

test('探す：旅の日程に土曜があれば、その日の花火大会の見本が立つ。開催日はいちばん早い開催の日', () => {
  const found = searchEvents({ kinds: ['fireworks'], bounds: null, prefectures: ['長野県'], named: [], exclude: [], startDate: FRIDAY, days: 2 })
  assert.ok(found.length > 0)
  for (const { place, event } of found) {
    assert.ok(place.area.startsWith('長野県'), place.area)
    assert.equal(event.date, SATURDAY)
    assert.equal(event.kind, 'fireworks')
    assert.equal(event.source, EVENT_SOURCE)
    assert.ok(isPinEvent(event))
    // 実在の大会のふりをしない
    assert.ok(place.name.startsWith('見本の'), place.name)
  }
})

test('探す：日程のあいだに開催がなければ空（平日だけの旅に花火はない。県の外の開催も出さない）', () => {
  assert.deepEqual(searchEvents({ kinds: ['fireworks'], bounds: null, prefectures: null, named: [], exclude: [], startDate: '2026-11-24', days: 3 }), [])
  // 長野の見学会は安曇野にある。旅が沖縄だけなら、日程に平日があっても見学会はない
  assert.deepEqual(searchEvents({ kinds: ['tour'], bounds: null, prefectures: ['沖縄県'], named: [], exclude: [], startDate: '2026-11-24', days: 2 }), [])
  // もうピンのある大会は出さない
  const names = EVENT_CATALOGUE.filter((entry) => entry.pref === '長野県' && entry.rule.kind === 'fireworks').map((entry) => entry.name)
  assert.deepEqual(searchEvents({ kinds: ['fireworks'], bounds: null, prefectures: ['長野県'], named: [], exclude: names, startDate: FRIDAY, days: 2 }), [])
})

test('探す：地図の範囲の中の開催を先に、範囲の中になければ範囲の真ん中に近い順', () => {
  const nagano = { north: 36.4, south: 35.9, east: 138.3, west: 137.8 }
  const [first] = searchEvents({ kinds: ['fireworks'], bounds: nagano, prefectures: null, named: [], exclude: [], startDate: FRIDAY, days: 2 })
  assert.equal(first.place.area, '長野県諏訪市')
})

test('固定する：イベントの行は、開催日の日に「始まり − 早めに着く分」に着き、終わりまでいる', () => {
  const plan = buildPlan([CASTLE, FIREWORKS], ORIGIN, 2, STYLE_TIMINGS.shortest)
  assert.equal(rowOf(plan, 'castle').day, 1)
  const row = rowOf(plan, 'fireworks')
  assert.equal(row.day, 2)
  assert.equal(row.time, '18:30')
  assert.equal(row.stayMinutes, 120)
  // 開始日が分からなければ固定しない（前の形の呼び出し）
  const { startDate: _unused, ...noDate } = ORIGIN
  assert.notEqual(rowOf(buildPlan([CASTLE, FIREWORKS], noDate, 2, STYLE_TIMINGS.shortest), 'fireworks').time, '18:30')
})

test('固定する：19 時を過ぎるイベントでも次の日に回さない。イベントのあとの場所は翌日へ', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const plan = buildPlan([CASTLE, FIREWORKS, SOBA], origin, 2, STYLE_TIMINGS.shortest)
  assert.equal(rowOf(plan, 'fireworks').day, 1)
  assert.equal(rowOf(plan, 'fireworks').time, '18:30')
  assert.equal(rowOf(plan, 'soba').day, 2)
})

test('固定する：人がイベントの行に直した時刻は使わない。前の場所にいる時間は、イベントに着くように伸びる', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const timing = { ...STYLE_TIMINGS.shortest, stopTimes: { fireworks: 12 * 60, 'fireworks@leave': 13 * 60 } }
  const plan = buildPlan([CASTLE, FIREWORKS], origin, 1, timing)
  const row = rowOf(plan, 'fireworks')
  assert.equal(row.time, '18:30')
  assert.equal(row.stayMinutes, 120)
  assert.deepEqual(plan.stopTimes, {})
  const castle = rowOf(plan, 'castle')
  assert.equal(minutesOf(castle.time) + castle.stayMinutes + castle.moveMinutesToNext, 18 * 60 + 30)
})

test('確かめる：前の予定を 0 分まで縮めても間に合わなければ late、縮めれば間に合うなら重なりではない', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  // スキー場（16 時まで）のあとなら、18:30 に諏訪へ着ける
  const fits = checksOf([SKI, FIREWORKS], origin, 1)
  assert.equal(fits.length, 1)
  assert.equal(fits[0].late, 0)
  assert.ok(fits[0].slack >= 0)
  // スキー場を 14 時に出ると直しても、縮めれば間に合うなら重なりではない（自動で組む余裕は足りない）
  const tight = checksOf([SKI, FIREWORKS], origin, 1, { ...STYLE_TIMINGS.shortest, stopTimes: { ski: 13 * 60 } })
  assert.equal(tight[0].late, 0)
  assert.ok(tight[0].slack < 0, '自動で組むときの余裕は足りない')
  assert.deepEqual(eventClashes(fits), [])
  // スキー場に 18 時に着くと、縮めても間に合わない
  const timing = { ...STYLE_TIMINGS.shortest, stopTimes: { ski: 18 * 60 } }
  const late = checksOf([SKI, FIREWORKS], origin, 1, timing)
  assert.ok(late[0].late > 0)
  assert.deepEqual(eventClashes(late), ['fireworks'])
})

test('確かめる：イベントの前の行の出る時刻を直したら、その時刻を守り、イベントに食い込めば late', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const timing = { ...STYLE_TIMINGS.shortest, stopTimes: { 'castle@leave': 18 * 60 + 20 } }
  const plan = buildPlan([CASTLE, FIREWORKS], origin, 1, timing)
  const castle = rowOf(plan, 'castle')
  assert.equal(minutesOf(castle.time) + castle.stayMinutes, 18 * 60 + 20)
  assert.equal(plan.stopTimes['castle@leave'], 18 * 60 + 20)
  assert.deepEqual(eventClashes(checksOf([CASTLE, FIREWORKS], origin, 1, timing)), ['fireworks'])
})

test('確かめる：イベントのあとの行の直した着く時刻が、イベントを出て移動し終わる前なら overlap', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const timing = { ...STYLE_TIMINGS.shortest, stopTimes: { soba: 20 * 60 } }
  const checks = checksOf([CASTLE, FIREWORKS, SOBA], { ...origin, startDate: SATURDAY }, 2, timing)
  // soba は翌日に回るので、20:00 は翌日の時刻。重ならない
  assert.deepEqual(eventClashes(checks), [])
  const sameDay = checksOf([FIREWORKS, SOBA], origin, 1, timing)
  assert.ok(sameDay[0].overlap > 0)
  assert.deepEqual(eventClashes(sameDay), ['fireworks'])
})

test('確かめる：開催日と違う日に並んだら、その日のずれも知らせる', () => {
  // 日程の 1 日目が土曜なのに、2 日目に回る（場所の数で日を分ける形）
  const timing = { startMinutes: 9 * 60, stayMinutes: 60 }
  const checks = checksOf([CASTLE, SOBA, FIREWORKS], { ...ORIGIN, startDate: SATURDAY }, 2, timing)
  assert.equal(checks[0].onDay, false)
  assert.ok(eventShortfall(checks) >= 10_000)
})

test('余裕：自動で組むときは、移動時間の 3 割と 30 分の大きいほう', () => {
  assert.equal(eventBufferMinutes(0), 30)
  assert.equal(eventBufferMinutes(60), 30)
  assert.equal(eventBufferMinutes(200), 60)
  assert.deepEqual(eventWindow(FIREWORKS_EVENT, FRIDAY, 2), { day: 2, arrive: 18 * 60 + 30, leave: 20 * 60 + 30 })
  assert.equal(eventWindow(FIREWORKS_EVENT, FRIDAY, 1), null)
})

test('差し込む：イベントのある日に長い場所を入れて余裕がなくなるなら、ほかの位置にする', () => {
  // 金土の旅。1 日目に城、2 日目に花火。スキー場（7 時間）を花火の直前に入れると余裕が足りないので、1 日目に入れる
  const order = [CASTLE, FIREWORKS]
  const timing = STYLE_TIMINGS.shortest
  const index = eventAwareIndex(order, SKI, ORIGIN, 2, timing)
  const placed = [...order.slice(0, index), SKI, ...order.slice(index)]
  assert.equal(eventShortfall(checksOf(placed, ORIGIN, 2, timing)), 0)
  assert.ok(placed.indexOf(SKI) < placed.indexOf(FIREWORKS))
  // イベントがなければ、今までどおり insertionIndex と同じ
  assert.equal(eventAwareIndex([CASTLE, SOBA], SKI, ORIGIN, 2, timing), insertionIndex([CASTLE, SOBA], SKI, ORIGIN))
})

test('並べ直す：守れない順番や、夜のイベントのあとに場所が並ぶ順番（Gemini や案の順番）は、イベントを入れ直す', () => {
  const timing = STYLE_TIMINGS.shortest
  // 花火を先頭に置くと、1 日目（金曜）が空になり、城とそばが花火のあとの夜に並ぶ
  const bad = [FIREWORKS, CASTLE, SOBA]
  const badPlan = buildPlan(bad, ORIGIN, 2, timing)
  assert.equal(rowOf(badPlan, 'castle').day, 2)
  const settled = settleEvents(bad, ORIGIN, 2, timing)
  assert.equal(eventShortfall(checksOf(settled, ORIGIN, 2, timing)), 0)
  const plan = buildPlan(settled, ORIGIN, 2, timing)
  assert.equal(rowOf(plan, 'castle').day, 1)
  assert.equal(rowOf(plan, 'soba').day, 1)
  assert.equal(rowOf(plan, 'fireworks').time, '18:30')
  // 開催日と違う日に入る順番（場所の数で日を分けると、土曜始まりの旅で花火が 2 日目に回る）も直す
  const byCount = { startMinutes: 9 * 60, stayMinutes: 60 }
  const saturday = { ...ORIGIN, startDate: SATURDAY }
  assert.ok(eventShortfall(checksOf([CASTLE, SOBA, FIREWORKS], saturday, 2, byCount)) >= 10_000)
  const fixed = settleEvents([CASTLE, SOBA, FIREWORKS], saturday, 2, byCount)
  assert.ok(eventShortfall(checksOf(fixed, saturday, 2, byCount)) < 10_000)
  // 守れている順番は変えない
  const good = [CASTLE, SOBA, FIREWORKS]
  assert.deepEqual(settleEvents(good, ORIGIN, 2, timing).map((place) => place.id), good.map((place) => place.id))
})

test('ピンから：planPlace はイベントの情報を渡し、tripOrigin は開始日を渡す', () => {
  const pin = { name: '見本の花火大会（諏訪）', location: FIREWORKS.location, uid: 'u1', category: 'nightview', event: FIREWORKS_EVENT }
  assert.deepEqual(planPlace('p1', pin).event, FIREWORKS_EVENT)
  // 形の違うイベントは渡さない
  assert.equal(planPlace('p1', { ...pin, event: { ...FIREWORKS_EVENT, end: 0 } }).event, undefined)
  assert.equal(tripOrigin({ origin: '松本駅', startDate: FRIDAY }).startDate, FRIDAY)
})

test('人が直す：イベントの時刻は直せない。重なるのは、直す前に重なっていなかったときだけ確かめる', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const order = [CASTLE, FIREWORKS]
  assert.equal(isEventTime(order, 'fireworks'), true)
  assert.equal(isEventTime(order, 'fireworks@leave'), true)
  assert.equal(isEventTime(order, 'castle'), false)
  const route = { style: 'shortest', revision: 1, legModes: {}, legFlights: {}, stopTimes: {}, lodging: undefined }
  const before = clashesWith(route, order, origin, 1, route.stopTimes)
  assert.deepEqual(before, [])
  // 城を 18:20 に出ると、18:30 の諏訪に間に合わない
  const update = routeWithStopTime(route, order, origin, 1, 'castle@leave', 18 * 60 + 20)
  const after = clashesWith({ ...update, style: 'shortest' }, order, origin, 1, update.stopTimes)
  assert.deepEqual(newClashes(before, after), ['fireworks'])
  // もう重なっているイベントは、もう一度は確かめない
  assert.deepEqual(newClashes(after, after), [])
  // 城を 12 時に出るなら重ならない
  const early = routeWithStopTime(route, order, origin, 1, 'castle@leave', 12 * 60)
  assert.deepEqual(clashesWith({ ...early, style: 'shortest' }, order, origin, 1, early.stopTimes), [])
})

test('並べ替え：イベントの行は取れない。ほかの行をイベントの前後に落とすのはよい', () => {
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const route = { style: 'shortest', pinIds: ['castle', 'soba', 'fireworks'], revision: 1, legModes: {}, legFlights: {}, stopTimes: {} }
  const places = [CASTLE, SOBA, FIREWORKS]
  assert.equal(moveStop(route, places, origin, 1, 'fireworks', 'castle'), null)
  const moved = moveStop(route, places, origin, 1, 'castle', 'soba')
  assert.deepEqual(moved.pinIds, ['soba', 'castle', 'fireworks'])
  assert.equal(rowOf(moved, 'fireworks').time, '18:30')
})

test('差し込む：夜の花火のために、ほかの場所を全部翌日へ回して、その日を待つだけにしない', () => {
  // 東京駅から車。土日の旅で、1 日目に美ヶ原高原・大王わさび農場・白骨温泉が並んでいるところへ、土曜の夜の諏訪の花火を足す
  const origin = { name: '東京駅', location: { lat: 35.6812, lng: 139.7671 }, travelMode: 'car', startDate: SATURDAY }
  const order = [at('utsukushi', 36.2236, 138.1078, 'nightview'), at('wasabi', 36.3364, 137.9067, 'farm'), at('shirahone', 36.1497, 137.6297, 'onsen')]
  const timing = STYLE_TIMINGS.shortest
  const index = eventAwareIndex(order, FIREWORKS, origin, 2, timing)
  const placed = [...order.slice(0, index), FIREWORKS, ...order.slice(index)]
  const plan = buildPlan(placed, origin, 2, timing)
  assert.equal(rowOf(plan, 'fireworks').day, 1)
  assert.equal(rowOf(plan, 'fireworks').time, '18:30')
  // 花火の前の 1 日目にも場所がある
  assert.ok(plan.schedule.some((stop) => stop.day === 1 && stop.pinId && stop.pinId !== 'fireworks'), JSON.stringify(placed.map((place) => place.id)))
  assert.equal(eventShortfall(checksOf(placed, origin, 2, timing)), 0)
})

test('集合場所を変えて組み直しても、イベントの時刻は固定のまま（resolve-origin。レビューの指摘）', () => {
  const { routeWithOrigin } = require('../functions/lib/features/resolve-origin/logic.js')
  const pin = (id, base, extra = {}) => ({ id, name: id, location: base.location, uid: 'u1', category: base.category, status: 'done', ...extra })
  const pins = [pin('castle', CASTLE), pin('fireworks', FIREWORKS, { event: FIREWORKS_EVENT })]
  const route = { style: 'shortest', pinIds: ['castle', 'fireworks'], revision: 1, legModes: {}, legFlights: {}, stopTimes: {} }
  const origin = { name: '長野駅', location: { lat: 36.643, lng: 138.189 }, travelMode: 'car', startDate: SATURDAY }
  const update = routeWithOrigin(route, pins, origin, 1)
  assert.equal(rowOf(update, 'fireworks').time, '18:30')
  assert.equal(rowOf(update, 'fireworks').stayMinutes, 120)
})

test('見分ける：「見学」の 1 語だけでは、イベントさがしにしない', () => {
  assert.equal(wantsEvent('酒蔵を見学したい'), null)
  assert.equal(wantsEvent('お城を見学したい'), null)
  assert.deepEqual(wantsEvent('催しを見たい'), ['fireworks', 'tour'])
})
