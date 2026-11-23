// しおりの時刻を人が直す決め（functions/src/domain/routePlan.ts の buildPlan、features/set-stop-time、reorder-shiori）を、
// Emulator なしで確かめる。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { buildPlan, STYLE_TIMINGS, routeTiming, MEET_KEY, ORIGIN_KEY } = require('../functions/lib/domain/routePlan.js')
const { routeWithStopTime, isDayMinutes, keepMeetBeforeDepart } = require('../functions/lib/features/set-stop-time/logic.js')
const { moveStop } = require('../functions/lib/features/reorder-shiori/logic.js')

// 車で、近い 3 か所（東京駅から）。時刻の式だけを見るので、場所はどこでもよい
const ORIGIN = { name: '東京駅', location: { lat: 35.6812, lng: 139.7671 }, travelMode: 'car' }
const PLACES = [
  { id: 'a', name: '浅草寺', location: { lat: 35.7148, lng: 139.7967 }, uid: 'u1' },
  { id: 'b', name: '東京スカイツリー', location: { lat: 35.7101, lng: 139.8107 }, uid: 'u2' },
  { id: 'c', name: '上野公園', location: { lat: 35.7156, lng: 139.7745 }, uid: 'u1' },
]
// 日をまたぐ場面を作るための形。スカイツリーと上野公園を終日の場所（7 時間）にすると、上野公園は 19 時までに入らず 2 日目に回る
// （#520 の時間での日の分け方）
const SPLIT_PLACES = PLACES.map((place) => (place.id === 'a' ? place : { ...place, category: 'themepark' }))
const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

test('しおりの時刻：集合場所の行に、出発時間と、その 15 分前の集合時間が入る', () => {
  const plan = buildPlan(PLACES, ORIGIN, 1, STYLE_TIMINGS.shortest)
  assert.equal(plan.schedule[0].pinId, null)
  assert.equal(plan.schedule[0].time, '09:00')
  assert.equal(plan.schedule[0].meetTime, '08:45')
  // 場所の行には集合時間はない
  assert.equal(plan.schedule[1].meetTime, undefined)
  // 直した時刻を渡さなければ、stopTimes は返さない（保存してある値を変えない）
  assert.equal('stopTimes' in plan, false)
})

test('しおりの時刻：出発時間を直すと 1 日目がそこから始まり、集合時間は決めていなければ 15 分前についてくる', () => {
  const base = buildPlan(PLACES, ORIGIN, 1, STYLE_TIMINGS.shortest)
  const plan = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { [ORIGIN_KEY]: 10 * 60 + 30 } }))
  assert.equal(plan.schedule[0].time, '10:30')
  assert.equal(plan.schedule[0].meetTime, '10:15')
  // あとの行は 90 分ずれる
  plan.schedule.slice(1).forEach((stop, index) => assert.equal(minutesOf(stop.time) - minutesOf(base.schedule[index + 1].time), 90))
  assert.deepEqual(plan.stopTimes, { [ORIGIN_KEY]: 630 })
})

test('しおりの時刻：集合時間を直しても、ほかの時刻は変わらない（出発より遅くても判定しない）', () => {
  const base = buildPlan(PLACES, ORIGIN, 1, STYLE_TIMINGS.shortest)
  const plan = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { [MEET_KEY]: 9 * 60 + 20 } }))
  assert.equal(plan.schedule[0].meetTime, '09:20')
  assert.deepEqual(plan.schedule.map((stop) => stop.time), base.schedule.map((stop) => stop.time))
})

test('しおりの時刻：場所に着く時刻を直すと、そこからあとがずれ、前の場所にいる時間が伸び縮みする', () => {
  const base = buildPlan(PLACES, ORIGIN, 1, STYLE_TIMINGS.shortest)
  const plan = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { b: 13 * 60 } }))
  const [, a, b, c] = plan.schedule
  assert.equal(b.time, '13:00')
  // 前の場所（a）は、13 時に b に着くようにいる
  assert.equal(minutesOf(a.time) + a.stayMinutes + a.moveMinutesToNext, 13 * 60)
  // b からあとは、b の時刻から組む
  assert.equal(minutesOf(c.time), 13 * 60 + b.stayMinutes + b.moveMinutesToNext)
  // a の時刻（直した所より前）は変わらない
  assert.equal(a.time, base.schedule[1].time)
})

test('しおりの時刻：移動に間に合わない早い時刻でも、入れた時刻をそのまま使い、前の場所にいる時間は 0 分で止める', () => {
  const plan = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { b: 9 * 60 } }))
  assert.equal(plan.schedule[2].time, '09:00')
  assert.equal(plan.schedule[1].stayMinutes, 0)
})

test('しおりの時刻：2 日目の 1 つ目の場所の時刻を直しても、前の日の場所にいる時間は変えない', () => {
  const base = buildPlan(SPLIT_PLACES, ORIGIN, 2, STYLE_TIMINGS.shortest)
  const firstOfDay2 = base.schedule.find((stop) => stop.day === 2)
  const plan = buildPlan(SPLIT_PLACES, ORIGIN, 2, routeTiming({ style: 'shortest', stopTimes: { [firstOfDay2.pinId]: 11 * 60 } }))
  assert.equal(plan.schedule.find((stop) => stop.day === 2).time, '11:00')
  assert.deepEqual(
    plan.schedule.filter((stop) => stop.day === 1).map((stop) => stop.stayMinutes),
    base.schedule.filter((stop) => stop.day === 1).map((stop) => stop.stayMinutes),
  )
})

test('しおりの時刻：今のしおりにない場所の時刻と、範囲の外の値は捨てる', () => {
  const plan = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { gone: 600, a: 24 * 60, [MEET_KEY]: 500 } }))
  assert.deepEqual(plan.stopTimes, { [MEET_KEY]: 500 })
})

test('時刻を直す：集合時間を出発より遅くすると、前の差を保って出発時間を後ろへずらす', () => {
  // 出発 10:00、集合 9:30（差 30 分）。集合を 10:20 にすると、出発は 10:50
  const route = { style: 'shortest', revision: 0, legModes: {}, legFlights: {}, stopTimes: { [MEET_KEY]: 570, [ORIGIN_KEY]: 600 } }
  const update = routeWithStopTime(route, PLACES, ORIGIN, 1, MEET_KEY, 620)
  assert.deepEqual(update.stopTimes, { [MEET_KEY]: 620, [ORIGIN_KEY]: 650 })
  assert.equal(update.schedule[0].meetTime, '10:20')
  assert.equal(update.schedule[0].time, '10:50')
  // 出発より早い集合時間なら、出発は変えない
  assert.deepEqual(keepMeetBeforeDepart(route, MEET_KEY, 540), { [MEET_KEY]: 540, [ORIGIN_KEY]: 600 })
  // 何も直していなければ、出発は組み方の始まり（9:00）、差は 15 分
  assert.deepEqual(keepMeetBeforeDepart({ style: 'shortest' }, MEET_KEY, 600), { [MEET_KEY]: 600, [ORIGIN_KEY]: 615 })
  // 23 時 59 分より後にはしない
  assert.deepEqual(keepMeetBeforeDepart(route, MEET_KEY, 1430), { [MEET_KEY]: 1430, [ORIGIN_KEY]: 1439 })
})

test('時刻を直す：出発時間を集合より早くすると、前の差を保って集合時間を前へずらす', () => {
  const route = { style: 'shortest', stopTimes: { [MEET_KEY]: 570, [ORIGIN_KEY]: 600 } }
  assert.deepEqual(keepMeetBeforeDepart(route, ORIGIN_KEY, 540), { [MEET_KEY]: 510, [ORIGIN_KEY]: 540 })
  // 集合より遅い出発なら、集合は変えない
  assert.deepEqual(keepMeetBeforeDepart(route, ORIGIN_KEY, 580), { [MEET_KEY]: 570, [ORIGIN_KEY]: 580 })
  // 0 時より前にはしない
  assert.deepEqual(keepMeetBeforeDepart(route, ORIGIN_KEY, 10), { [MEET_KEY]: 0, [ORIGIN_KEY]: 10 })
  // 集合時間を直していなければ、集合は保存しない（いつも出発の 15 分前について来る）
  assert.deepEqual(keepMeetBeforeDepart({ style: 'shortest' }, ORIGIN_KEY, 520), { [ORIGIN_KEY]: 520 })
  const early = routeWithStopTime({ style: 'shortest', revision: 0, legModes: {}, legFlights: {} }, PLACES, ORIGIN, 1, ORIGIN_KEY, 520)
  const later = routeWithStopTime({ style: 'shortest', revision: 1, legModes: {}, legFlights: {}, stopTimes: early.stopTimes }, PLACES, ORIGIN, 1, ORIGIN_KEY, 700)
  assert.equal(later.schedule[0].meetTime, '11:25')
  // 前の形で集合が出発より遅かったら、差は 15 分
  assert.deepEqual(keepMeetBeforeDepart({ style: 'shortest', stopTimes: { [MEET_KEY]: 620, [ORIGIN_KEY]: 600 } }, MEET_KEY, 700), { [MEET_KEY]: 700, [ORIGIN_KEY]: 715 })
})

test('時刻を直す：保存する中身。しおりにない場所は stale、組み直しの回数は 1 増える', () => {
  const route = { style: 'shortest', revision: 2, legModes: {}, legFlights: {}, stopTimes: { [MEET_KEY]: 500 } }
  const update = routeWithStopTime(route, PLACES, ORIGIN, 1, ORIGIN_KEY, 600)
  assert.equal(update.revision, 3)
  assert.deepEqual(update.stopTimes, { [MEET_KEY]: 500, [ORIGIN_KEY]: 600 })
  assert.equal(update.schedule[0].time, '10:00')
  assert.equal(update.schedule[0].meetTime, '08:20')
  assert.equal(routeWithStopTime(route, PLACES, ORIGIN, 1, 'gone', 600), 'stale')
  assert.equal(isDayMinutes(0), true)
  assert.equal(isDayMinutes(1439), true)
  assert.equal(isDayMinutes(1440), false)
  assert.equal(isDayMinutes(9.5), false)
})

test('時刻を直す：行を動かすと、位置が変わった行の着く時刻だけを外す', () => {
  const route = { style: 'shortest', pinIds: ['a', 'b', 'c'], revision: 0, legModes: {}, legFlights: {}, stopTimes: { a: 600, b: 780, c: 900, [ORIGIN_KEY]: 540 } }
  const update = moveStop(route, PLACES, ORIGIN, 1, 'a', 'b')
  assert.deepEqual(update.stopTimes, { c: 900, [ORIGIN_KEY]: 540 })
  assert.equal(update.schedule.find((stop) => stop.pinId === 'c').time, '15:00')
})

test('しおりの時刻：飛行機の区間の先の場所の着く時刻を直しても、前の場所にいる時間と便は変えず、余りは着いた先の待ちにする', () => {
  // 東京駅 → 浅草寺 → 福岡（飛行機の区間）。3 時間ごとに出る便で、所要時間は待ちと乗っている 60 分
  const far = [PLACES[0], { id: 'f', name: '福岡タワー', location: { lat: 33.5933, lng: 130.3515 }, uid: 'u2' }]
  const plan = (from, to, departAt, day) => {
    const dep = Math.ceil(departAt / 180) * 180
    return { minutes: dep - departAt + 60, flight: null, fetchedAt: null, departAt, day }
  }
  const base = buildPlan(far, ORIGIN, 1, STYLE_TIMINGS.shortest, undefined, { 'a>f': 'plane' }, { plan })
  const fixed = buildPlan(far, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { f: 18 * 60 } }), undefined, { 'a>f': 'plane' }, { plan })
  const [, a, f] = fixed.schedule
  assert.equal(f.time, '18:00')
  // 浅草寺にいる時間と便は、直さないときと同じ。便は浅草寺を出たあとに出て、直した時刻までに着く
  assert.equal(a.stayMinutes, base.schedule[1].stayMinutes)
  assert.deepEqual(fixed.legFlights['a>f'], base.legFlights['a>f'])
  const leave = minutesOf(a.time) + a.stayMinutes
  assert.equal(fixed.legFlights['a>f'].departAt, leave)
  assert.ok(leave + a.moveMinutesToNext <= 18 * 60)
  // 保存してある便で組み直しても、同じしおりになる
  const again = buildPlan(far, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { f: 18 * 60 } }), undefined, { 'a>f': 'plane' }, { saved: fixed.legFlights })
  assert.deepEqual(again.schedule, fixed.schedule)
})

test('時刻を直す：既定で飛行機になった区間（札幌 → 那覇）のあとの場所の時刻を直しても、前の場所にいる時間は変えない', () => {
  const origin = { name: '札幌駅', location: null, travelMode: 'transit' }
  const places = [
    { id: 'sapporo', name: '大通公園', location: { lat: 43.0598, lng: 141.3469 }, uid: 'u1' },
    { id: 'naha', name: '国際通り', location: { lat: 26.2155, lng: 127.6857 }, uid: 'u1' },
  ]
  const route = { style: 'shortest', revision: 0, legModes: {}, legFlights: {} }
  const before = routeWithStopTime(route, places, origin, 1, 'sapporo', 600)
  const stay = before.schedule.find((stop) => stop.pinId === 'sapporo').stayMinutes
  const naha = minutesOf(before.schedule.find((stop) => stop.pinId === 'naha').time)
  const update = routeWithStopTime({ ...route, stopTimes: before.stopTimes }, places, origin, 1, 'naha', naha + 120)
  assert.deepEqual(update.legModes, {}, '既定の飛行機は区間の選択に入らない')
  assert.equal(update.schedule.find((stop) => stop.pinId === 'sapporo').stayMinutes, stay)
  assert.equal(update.schedule.find((stop) => stop.pinId === 'naha').time, before.schedule.find((stop) => stop.pinId === 'naha').time.replace(/^\d\d:\d\d$/, () => {
    const m = naha + 120
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }))
})

test('しおりの時刻：場所を出る時刻を直すと、その場所にいる時間が変わり、そこからあとがずれる', () => {
  const base = buildPlan(PLACES, ORIGIN, 1, STYLE_TIMINGS.shortest)
  const arrivedA = minutesOf(base.schedule[1].time)
  const plan = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { 'a@leave': arrivedA + 150 } }))
  const [, a, b, c] = plan.schedule
  // a の着く時刻は変わらず、いる時間が 150 分になる
  assert.equal(a.time, base.schedule[1].time)
  assert.equal(a.stayMinutes, 150)
  // b からあとは、a を出た時刻から組む（直す前より 90 分遅い）
  assert.equal(minutesOf(b.time), arrivedA + 150 + a.moveMinutesToNext)
  assert.equal(minutesOf(c.time) - minutesOf(base.schedule[3].time), 90)
  assert.deepEqual(plan.stopTimes, { 'a@leave': arrivedA + 150 })
  // 着く時刻より早い出る時刻は、いる時間 0 分にする
  const early = buildPlan(PLACES, ORIGIN, 1, routeTiming({ style: 'shortest', stopTimes: { 'a@leave': 0 } }))
  assert.equal(early.schedule[1].stayMinutes, 0)
})

test('時刻を直す：出る時刻を直すと次の場所の着く時刻が外れ、着く時刻を直すと前の場所の出る時刻が外れる', () => {
  const route = { style: 'shortest', revision: 0, legModes: {}, legFlights: {}, stopTimes: { b: 13 * 60, 'b@leave': 14 * 60, c: 15 * 60 } }
  const leaving = routeWithStopTime(route, PLACES, ORIGIN, 1, 'a@leave', 11 * 60)
  assert.deepEqual(leaving.stopTimes, { 'a@leave': 660, c: 900 })
  assert.equal(leaving.schedule[1].stayMinutes, 660 - minutesOf(leaving.schedule[1].time))
  const arriving = routeWithStopTime(route, PLACES, ORIGIN, 1, 'c', 16 * 60)
  assert.deepEqual(arriving.stopTimes, { b: 780, c: 960 })
  // 出る時刻のキーでも、しおりにない行は stale
  assert.equal(routeWithStopTime(route, PLACES, ORIGIN, 1, 'gone@leave', 600), 'stale')
})

test('時刻を直す：行を動かすと、位置が変わった行の出る時刻も外す', () => {
  const route = { style: 'shortest', pinIds: ['a', 'b', 'c'], revision: 0, legModes: {}, legFlights: {}, stopTimes: { 'a@leave': 700, 'b@leave': 800, 'c@leave': 1000 } }
  const update = moveStop(route, PLACES, ORIGIN, 1, 'a', 'b')
  assert.deepEqual(update.stopTimes, { 'c@leave': 1000 })
})

test('しおりの時刻：前の場所の出る時刻と次の場所の着く時刻が両方あると、着く時刻が勝ち、出る時刻は残さない（建物を消して隣り合ったとき）', () => {
  const route = { style: 'shortest', pinIds: ['a', 'b', 'c'], revision: 0, legModes: {}, legFlights: {}, stopTimes: { 'a@leave': 700, c: 900 } }
  // b の建物を消すと、a と c が隣り合う
  const plan = buildPlan([PLACES[0], PLACES[2]], ORIGIN, 1, routeTiming(route))
  assert.deepEqual(plan.stopTimes, { c: 900 })
  assert.equal(plan.schedule.find((stop) => stop.pinId === 'c').time, '15:00')
})

test('時刻を直す：日をまたぐとなりの行の出る時刻と着く時刻は、ぶつからないので両方残す', () => {
  // 2 日に分けると a, b が 1 日目、c（終日の場所）が 2 日目
  const route = { style: 'shortest', revision: 0, legModes: {}, legFlights: {}, stopTimes: { 'b@leave': 17 * 60 } }
  const update = routeWithStopTime(route, SPLIT_PLACES, ORIGIN, 2, 'c', 10 * 60)
  assert.deepEqual(update.stopTimes, { 'b@leave': 1020, c: 600 })
  const back = routeWithStopTime({ ...route, stopTimes: { c: 600 } }, SPLIT_PLACES, ORIGIN, 2, 'b@leave', 17 * 60)
  assert.deepEqual(back.stopTimes, { 'b@leave': 1020, c: 600 })
})
