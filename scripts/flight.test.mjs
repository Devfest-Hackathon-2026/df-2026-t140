// 飛行機の区間（functions/src/domain/flight.ts、adapters/odpt.ts の読み取り、features/change-leg-mode）を、Emulator なしで確かめる。
// 時刻表は偽物（実在の便名・時刻ではない）。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { planFlight, calendarMatches, estimatedFlightMinutes, PLANE_MIN_KM, reuseFlight, planeByDefault, defaultLegMode } = require('../functions/lib/domain/flight.js')
const { groundMode } = require('../functions/lib/domain/travelMode.js')
const { parseAirports, parseSchedules, timetableSummary, scheduleQueries } = require('../functions/lib/adapters/odpt.js')
const { estimateMinutes, buildPlan, STYLE_TIMINGS } = require('../functions/lib/domain/routePlan.js')
// 場所の数で日に分ける時間の決め（stayScale なし）。日をまたぐ飛行機の区間の場面を作るのに使う（#520 からしおりは時間で分けるため）
const BY_COUNT = { startMinutes: 9 * 60, stayMinutes: 60 }
const { routeWithLegMode, flightPlanner, dateOfDay } = require('../functions/lib/features/change-leg-mode/logic.js')
const { routeWithMode } = require('../functions/lib/features/change-travel-mode/logic.js')
const { searchingFlights, TimetableNeeded } = require('../functions/lib/domain/flightPlanner.js')
const { draftShiori, addToDecidedRoute } = require('../functions/lib/features/propose-routes/logic.js')
const { moveStop } = require('../functions/lib/features/reorder-shiori/logic.js')
const { routeAfterRemoval } = require('../functions/lib/features/remove-building/logic.js')
const { routeWithOrigin } = require('../functions/lib/features/resolve-origin/logic.js')
const { routeWithStopTime } = require('../functions/lib/features/set-stop-time/logic.js')

const OMIYA = { lat: 35.9064, lng: 139.6239 }
const SAKYU = { lat: 35.5409, lng: 134.229 }
const AIRPORTS = [
  { code: 'HND', name: '東京(羽田)', location: { lat: 35.5494, lng: 139.7798 } },
  { code: 'NRT', name: '東京(成田)', location: { lat: 35.772, lng: 140.3929 } },
  { code: 'TTJ', name: '鳥取', location: { lat: 35.5301, lng: 134.1668 } },
  { code: 'YGJ', name: '米子', location: { lat: 35.4922, lng: 133.2364 } },
]
const run = (number, dep, arr) => ({ numbers: [number], airline: 'ANA', dep, arr })
const at = (h, m = 0) => h * 60 + m
// 2026-11-21 は土曜日
const TIMETABLE = {
  airports: AIRPORTS,
  routes: [
    { from: 'HND', to: 'TTJ', calendar: 'odpt.Calendar:SaturdayHoliday', flights: [run('NH291', at(7, 25), at(8, 45)), run('NH293', at(12, 0), at(13, 20)), run('NH295', at(17, 0), at(18, 20))] },
    { from: 'HND', to: 'TTJ', calendar: 'odpt.Calendar:Weekday', flights: [run('NH999', at(11, 0), at(12, 20))] },
    { from: 'HND', to: 'YGJ', calendar: 'odpt.Calendar:SaturdayHoliday', flights: [run('NH381', at(11, 30), at(12, 50))] },
  ],
  fetchedAt: '2026-11-18T13:00:00.000Z',
}
const ground = (from, to) => estimateMinutes(from, to, 'transit')

test('飛行機：大宮から鳥取砂丘へ、乗れる最初の便のうち最も早く着く空港の組み合わせを選ぶ', () => {
  const leg = planFlight({ from: OMIYA, to: SAKYU, departAt: at(9), date: '2026-11-21', ground }, TIMETABLE)
  assert.ok(leg.flight, '時刻表から便を選ぶ')
  // 7:25 発は、9:00 に大宮を出てからでは間に合わない。米子の便は鳥取空港の便より着いてから遠い
  assert.notEqual(leg.flight.numbers[0], 'NH291')
  // 米子（NH381）は羽田を先に出るが、米子空港から鳥取砂丘が遠いので、鳥取空港に着く NH293 のほうが早く着く
  assert.equal(leg.flight.numbers[0], 'NH293')
  assert.equal(leg.flight.from.code, 'HND')
  assert.equal(leg.minutes % 5, 0)
  assert.equal(leg.fetchedAt, TIMETABLE.fetchedAt)
  // 平日だけの便（NH999）は、土曜日には選ばない
  assert.notEqual(leg.flight.numbers[0], 'NH999')
})

test('飛行機：成田からの便がないので、成田は選ばない。その日の便がもうなければ距離の式の目安', () => {
  const leg = planFlight({ from: OMIYA, to: SAKYU, departAt: at(9), date: '2026-11-21', ground }, TIMETABLE)
  assert.notEqual(leg.flight.from.code, 'NRT')
  const late = planFlight({ from: OMIYA, to: SAKYU, departAt: at(20), date: '2026-11-21', ground }, TIMETABLE)
  assert.equal(late.flight, null)
  assert.equal(late.minutes, estimatedFlightMinutes(OMIYA, SAKYU))
})

test('飛行機：時刻表がないときは距離の式の目安', () => {
  const leg = planFlight({ from: OMIYA, to: SAKYU, departAt: at(9), date: '2026-11-21', ground }, null)
  assert.deepEqual(leg, { minutes: estimatedFlightMinutes(OMIYA, SAKYU), flight: null, fetchedAt: null, departAt: at(9) })
})

test('飛行機：時刻表の曜日を、その日の曜日・平日・土休日で選ぶ', () => {
  assert.equal(calendarMatches('odpt.Calendar:Saturday', '2026-11-21'), true)
  assert.equal(calendarMatches('odpt.Calendar:SaturdayHoliday', '2026-11-22'), true)
  assert.equal(calendarMatches('odpt.Calendar:Weekday', '2026-11-23'), true)
  assert.equal(calendarMatches('odpt.Calendar:Weekday', '2026-11-21'), false)
  assert.equal(dateOfDay('2026-11-30', 2), '2026-12-01')
})

test('飛行機：ODPT の応答から、国内の空港と直行便だけを取り出す', () => {
  const airports = parseAirports([
    { 'owl:sameAs': 'odpt.Airport:HND', 'odpt:airportTitle': { ja: '東京(羽田)' }, 'geo:lat': 35.55, 'geo:long': 139.78 },
    { 'owl:sameAs': 'odpt.Airport:LAX', 'dc:title': 'ロサンゼルス', 'geo:lat': 33.94, 'geo:long': -118.4 },
    // 位置がなく、補う表（AIRPORT_LOCATIONS）にもない空港は外す
    { 'owl:sameAs': 'odpt.Airport:ZZZ', 'dc:title': '不明' },
  ])
  assert.deepEqual(airports.map((airport) => airport.code), ['HND'])
  const routes = parseSchedules([
    {
      'odpt:originAirport': 'odpt.Airport:HND',
      'odpt:destinationAirport': 'odpt.Airport:TTJ',
      'odpt:calendar': 'odpt.Calendar:Monday',
      'odpt:flightScheduleObject': [
        { 'odpt:airline': 'odpt.Operator:ANA', 'odpt:flightNumber': ['NH293'], 'odpt:originTime': '12:00', 'odpt:destinationTime': '13:20' },
        { 'odpt:airline': 'odpt.Operator:ANA', 'odpt:flightNumber': ['NH100'], 'odpt:originTime': '09:00', 'odpt:destinationTime': '12:00', 'odpt:viaAirport': ['odpt.Airport:ITM'] },
        { 'odpt:airline': 'odpt.Operator:ANA', 'odpt:flightNumber': ['NH900'], 'odpt:originTime': '23:30', 'odpt:destinationTime': '00:50', 'odpt:destinationDayDifference': 1 },
      ],
    },
  ])
  assert.equal(routes.length, 1)
  assert.deepEqual(routes[0].flights.map((flight) => [flight.numbers[0], flight.airline, flight.dep, flight.arr]), [
    ['NH293', 'ANA', at(12), at(13, 20)],
    ['NH900', 'ANA', at(23, 30), 1440 + 50],
  ])
})

const PLACES = [
  { id: 'sakyu', name: '鳥取砂丘', location: SAKYU, uid: 'u' },
  { id: 'castle', name: '鳥取城跡', location: { lat: 35.5108, lng: 134.2433 }, uid: 'u' },
]
const ORIGIN = { name: '大宮駅', location: OMIYA, travelMode: 'transit' }

test('飛行機の区間：選ぶと便を決めてルートに残し、組み直すときは残した所要時間を使う。近い区間では選べない', () => {
  const route = { style: 'shortest', revision: 0, legModes: {}, legFlights: {} }
  const flights = { plan: flightPlanner(TIMETABLE, ORIGIN, '2026-11-21') }
  const update = routeWithLegMode(route, PLACES, ORIGIN, 1, '@origin', 'sakyu', 'plane', flights)
  assert.deepEqual(update.legModes, { '@origin>sakyu': 'plane' })
  const leg = update.legFlights['@origin>sakyu']
  assert.ok(leg.flight)
  assert.equal(update.schedule[0].moveMinutesToNext, leg.minutes)
  // 組み直し（時刻表なし）では、残した便の所要時間を使う
  const replan = buildPlan(PLACES, ORIGIN, 1, STYLE_TIMINGS.shortest, undefined, update.legModes, { saved: update.legFlights })
  assert.equal(replan.schedule[0].moveMinutesToNext, leg.minutes)
  assert.deepEqual(replan.legFlights, update.legFlights)
  // 鳥取砂丘 → 鳥取城跡は 200 km よりずっと近い
  assert.ok(PLANE_MIN_KM === 200)
  assert.equal(routeWithLegMode(route, PLACES, ORIGIN, 1, 'sakyu', 'castle', 'plane', flights), 'too-near')
})

test('飛行機：組み直しで出発が遅くなったり日が変わったりしたら、残した便は使わない。早くなったら同じ便で待つ時間が延びる', () => {
  const saved = { ...planFlight({ from: OMIYA, to: SAKYU, departAt: at(9), date: '2026-11-21', ground }, TIMETABLE), day: 1 }
  const earlier = reuseFlight(saved, at(8), 1)
  assert.equal(earlier.flight.numbers[0], saved.flight.numbers[0])
  assert.equal(earlier.minutes, saved.minutes + 60)
  assert.equal(reuseFlight(saved, at(10), 1), null)
  assert.equal(reuseFlight(saved, at(9), 2), null)
  // 組み直し（buildPlan）では、乗れないかもしれない便を外して目安にする
  const late = buildPlan(PLACES, { ...ORIGIN }, 1, { startMinutes: at(10), stayMinutes: 60 }, undefined, { '@origin>sakyu': 'plane' }, { saved: { '@origin>sakyu': saved } })
  assert.equal(late.legFlights['@origin>sakyu'].flight, null)
  assert.equal(late.schedule[0].moveMinutesToNext, estimatedFlightMinutes(OMIYA, SAKYU))
})

test('飛行機：時刻表の有効期間の外の便は選ばない', () => {
  const limited = { ...TIMETABLE, routes: [{ ...TIMETABLE.routes[0], flights: [{ ...run('NH293', at(12), at(13, 20)), validTo: '2026-11-20' }] }] }
  const leg = planFlight({ from: OMIYA, to: SAKYU, departAt: at(9), date: '2026-11-21', ground }, limited)
  assert.equal(leg.flight, null)
})

test('飛行機：日をまたぐ区間は、次の日の始まりの時刻と日で便を探す', () => {
  const calls = []
  const plan = (from, to, departAt, day) => (calls.push([departAt, day]), { minutes: 300, flight: null, fetchedAt: null, departAt, day })
  // 1 日目に鳥取砂丘、2 日目に大宮（遠い区間）。日をまたぐ区間は 2 日目の朝 9:00 発として探す
  const places = [PLACES[0], { id: 'omiya', name: '大宮', location: OMIYA, uid: 'u' }]
  buildPlan(places, { name: '鳥取駅', location: null, travelMode: 'transit' }, 2, BY_COUNT, undefined, { 'sakyu>omiya': 'plane' }, { plan })
  assert.deepEqual(calls, [[BY_COUNT.startMinutes, 2]])
})

test('飛行機：その日に乗れる便がないときは、目安で組み、最終便の時刻と空港に着く時刻を添える。便のない路線では添えない', () => {
  const late = planFlight({ from: OMIYA, to: SAKYU, departAt: at(20), date: '2026-11-21', ground }, TIMETABLE)
  assert.equal(late.flight, null)
  assert.equal(late.minutes, estimatedFlightMinutes(OMIYA, SAKYU))
  // 土休日の便のうち最も遅く出るのは羽田→鳥取の NH295（17:00 発）。手続きの 60 分前に空港へ
  assert.deepEqual(
    [late.lastFlight.number, late.lastFlight.from.code, late.lastFlight.dep, late.lastFlight.arriveAirportBy],
    ['NH295', 'HND', '17:00', '16:00'],
  )
  assert.equal(late.fetchedAt, TIMETABLE.fetchedAt)
  const noRoute = planFlight({ from: SAKYU, to: OMIYA, departAt: at(9), date: '2026-11-21', ground }, TIMETABLE)
  assert.equal(noRoute.lastFlight, undefined)
})

test('飛行機：1 つの区間を押し直しても、ほかの飛行機の区間は残した便を使う', () => {
  const saved = { 'sakyu>omiya': { minutes: 333, flight: { numbers: ['X1'], airline: 'ANA', from: { code: 'TTJ', name: '鳥取' }, to: { code: 'HND', name: '羽田' }, dep: '12:00', arr: '13:20' }, fetchedAt: 'x', departAt: at(9), day: 2 } }
  const places = [PLACES[0], { id: 'omiya', name: '大宮', location: OMIYA, uid: 'u' }]
  const plan = () => ({ minutes: 999, flight: null, fetchedAt: null })
  const result = buildPlan(places, { ...ORIGIN }, 2, STYLE_TIMINGS.shortest, undefined, { '@origin>sakyu': 'plane', 'sakyu>omiya': 'plane' }, { plan, planKey: '@origin>sakyu', saved })
  assert.equal(result.legFlights['@origin>sakyu'].minutes, 999)
  assert.equal(result.legFlights['sakyu>omiya'].flight.numbers[0], 'X1')
})

test('飛行機：日をまたぐ飛行機の区間では、翌日の 1 つ目の場所を到着のあとの時刻にする', () => {
  const places = [PLACES[0], { id: 'omiya', name: '大宮', location: OMIYA, uid: 'u' }]
  const plan = (from, to, departAt, day) => ({ minutes: 300, flight: null, fetchedAt: null, departAt, day })
  const result = buildPlan(places, { name: '鳥取駅', location: null, travelMode: 'transit' }, 2, BY_COUNT, undefined, { 'sakyu>omiya': 'plane' }, { plan })
  const omiya = result.schedule.find((stop) => stop.pinId === 'omiya')
  // 9:00 に出て 300 分 → 14:00
  assert.equal(omiya.time, '14:00')
  // 飛行機でない日またぎも、翌日の始まりに移動を足した時刻（宿を取らない夜の翌朝も、前の日の最後の場所から移動する。#602）
  const transit = buildPlan(places, { name: '鳥取駅', location: null, travelMode: 'transit' }, 2, BY_COUNT)
  const before = transit.schedule.find((stop) => stop.pinId === 'sakyu')
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  assert.equal(minutes(transit.schedule.find((stop) => stop.pinId === 'omiya').time), 9 * 60 + before.moveMinutesToNext)
})

test('ODPT：取得に失敗したら 5 分は呼び直さず、過ぎたら呼び直す（本物の API は呼ばない）', async () => {
  const { odptFlights } = require('../functions/lib/adapters/odpt.js')
  const saved = { fetch: globalThis.fetch, now: Date.now, key: process.env.ODPT_CONSUMER_KEY, emulator: process.env.FUNCTIONS_EMULATOR }
  let calls = 0
  let clock = 1_000_000
  try {
    process.env.ODPT_CONSUMER_KEY = 'test-key-not-real'
    delete process.env.FUNCTIONS_EMULATOR
    Date.now = () => clock
    globalThis.fetch = async () => {
      calls += 1
      throw new Error('つながらない（テスト）')
    }
    assert.equal(await odptFlights.timetable(), null)
    const first = calls
    assert.ok(first > 0, '1 回目は呼ぶ')
    clock += 60 * 1000
    assert.equal(await odptFlights.timetable(), null)
    assert.equal(calls, first, '失敗から 1 分では呼び直さない')
    clock += 5 * 60 * 1000
    assert.equal(await odptFlights.timetable(), null)
    assert.ok(calls > first, '5 分を過ぎたら呼び直す')
  } finally {
    globalThis.fetch = saved.fetch
    Date.now = saved.now
    if (saved.key === undefined) delete process.env.ODPT_CONSUMER_KEY
    else process.env.ODPT_CONSUMER_KEY = saved.key
    if (saved.emulator !== undefined) process.env.FUNCTIONS_EMULATOR = saved.emulator
  }
})

test('飛行機：最終便は、出る時刻ではなく、空港までの移動と手続きを足して、出発地を最も遅く出ても間に合う便を選ぶ', () => {
  // 成田の便は羽田の便より 30 分遅く出るが、成田までは 60 分長くかかるので、大宮を遅く出ても間に合うのは羽田の便
  const routes = [
    { from: 'HND', to: 'TTJ', calendar: 'odpt.Calendar:SaturdayHoliday', flights: [run('NH295', at(17, 0), at(18, 20))] },
    { from: 'NRT', to: 'TTJ', calendar: 'odpt.Calendar:SaturdayHoliday', flights: [run('NH777', at(17, 30), at(18, 50))] },
  ]
  // 空港までの移動は、羽田 60 分、成田 120 分とする（見本）
  const farNarita = (from, to) => (to === AIRPORTS[1].location ? 120 : 60)
  const late = planFlight({ from: OMIYA, to: SAKYU, departAt: at(20), date: '2026-11-21', ground: farNarita }, { ...TIMETABLE, routes })
  assert.equal(late.flight, null)
  assert.deepEqual([late.lastFlight.number, late.lastFlight.from.code], ['NH295', 'HND'])
})

test('飛行機：目安を組み直しで使い回すとき、出発の時刻か日が変わったら、前の最終便の案内を外す', () => {
  const estimate = { minutes: 400, flight: null, fetchedAt: 'x', departAt: at(20), day: 1, lastFlight: { airline: 'ANA', number: 'NH295', from: { code: 'HND', name: '羽田' }, to: { code: 'TTJ', name: '鳥取' }, dep: '17:00', arriveAirportBy: '16:00' } }
  assert.equal(reuseFlight(estimate, at(20), 1).lastFlight.number, 'NH295')
  assert.equal(reuseFlight(estimate, at(9), 1).lastFlight, undefined)
  assert.equal(reuseFlight(estimate, at(20), 2).lastFlight, undefined)
})

const TOKYO_STATION = { lat: 35.68124, lng: 139.76712 }
const KOKUSAI_DORI = { lat: 26.2155, lng: 127.6857 }
const OSAKA_STATION = { lat: 34.7025, lng: 135.4959 }

test('飛行機の既定：遠い区間（600 km 以上）と、島（北緯 30 度より南）への 200 km 以上の区間だけ', () => {
  assert.equal(planeByDefault(TOKYO_STATION, KOKUSAI_DORI), true)
  assert.equal(planeByDefault(TOKYO_STATION, { lat: 43.0687, lng: 141.3508 }), true, '東京 → 札幌')
  assert.equal(planeByDefault(TOKYO_STATION, OSAKA_STATION), false, '東京 → 大阪は約 400 km')
  assert.equal(planeByDefault(KOKUSAI_DORI, { lat: 24.3448, lng: 124.1572 }), true, '那覇 → 石垣は約 410 km')
  assert.equal(planeByDefault(KOKUSAI_DORI, { lat: 26.6944, lng: 127.8779 }), false, '那覇 → 美ら海水族館は近い')
})

test('飛行機の既定：選んでいない東京駅 → 那覇の区間は、旅全体が電車・バスでも飛行機で組む。大阪は旅全体の手段', () => {
  const origin = { name: '東京駅', location: TOKYO_STATION, travelMode: 'transit' }
  const naha = [{ id: 'naha', name: '国際通り', location: KOKUSAI_DORI, uid: 'u' }]
  const plan = buildPlan(naha, origin, 1, STYLE_TIMINGS.shortest, undefined, {})
  assert.equal(plan.schedule[0].moveMinutesToNext, estimatedFlightMinutes(TOKYO_STATION, KOKUSAI_DORI))
  assert.deepEqual(plan.legModes, {}, '既定の飛行機は、区間の選択として残さない')
  // しおりを作るとき（legModes を渡さない）も飛行機
  assert.equal(buildPlan(naha, origin, 1, STYLE_TIMINGS.shortest).schedule[0].moveMinutesToNext, estimatedFlightMinutes(TOKYO_STATION, KOKUSAI_DORI))
  const osaka = [{ id: 'osaka', name: '大阪駅', location: OSAKA_STATION, uid: 'u' }]
  assert.equal(buildPlan(osaka, origin, 1, STYLE_TIMINGS.shortest).schedule[0].moveMinutesToNext, estimateMinutes(TOKYO_STATION, OSAKA_STATION, 'transit'))
})

test('飛行機の既定：既定が飛行機の区間で電車・バスを選ぶと残り、旅全体を切り替えても残る。飛行機を押すと選択を外して便を探す', () => {
  const origin = { name: '東京駅', location: TOKYO_STATION, travelMode: 'transit' }
  const places = [{ id: 'naha', name: '国際通り', location: KOKUSAI_DORI, uid: 'u' }]
  const route = { style: 'shortest', revision: 0, legModes: {}, legFlights: {} }
  const transit = routeWithLegMode(route, places, origin, 1, '@origin', 'naha', 'transit')
  assert.deepEqual(transit.legModes, { '@origin>naha': 'transit' })
  assert.equal(transit.schedule[0].moveMinutesToNext, estimateMinutes(TOKYO_STATION, KOKUSAI_DORI, 'transit'))
  // 旅全体を電車・バスのままにしても（同じ手段でも）、この区間の選択は外さない
  const switched = routeWithMode({ ...route, pinIds: ['naha'], legModes: transit.legModes }, [{ id: 'naha', ...places[0] }], origin, 1)
  assert.equal(switched.legModes['@origin>naha'], 'transit')
  // 飛行機を押すと、既定と同じなので選択を外し、時刻表から便を探す
  const timetable = {
    airports: [
      { code: 'HND', name: '東京(羽田)', location: { lat: 35.5494, lng: 139.7798 } },
      { code: 'OKA', name: '那覇', location: { lat: 26.1958, lng: 127.6459 } },
    ],
    routes: [{ from: 'HND', to: 'OKA', calendar: 'odpt.Calendar:Thursday', flights: [run('XX1', at(11), at(13, 50))] }],
    fetchedAt: '2026-11-19T00:00:00.000Z',
  }
  const flights = { plan: flightPlanner(timetable, origin, '2026-11-19'), planKey: '@origin>naha', saved: {} }
  const plane = routeWithLegMode({ ...route, legModes: transit.legModes }, places, origin, 1, '@origin', 'naha', 'plane', flights)
  assert.deepEqual(plane.legModes, {})
  assert.equal(plane.legFlights['@origin>naha'].flight.numbers[0], 'XX1')
})

test('ODPT：位置のない空港は主要な空港の位置で補い、読んだ件数の要約を作る', () => {
  const airports = parseAirports([{ 'owl:sameAs': 'odpt.Airport:OKA', 'dc:title': '那覇' }, { 'owl:sameAs': 'odpt.Airport:ZZZ', 'dc:title': '不明' }])
  assert.deepEqual(airports.map((airport) => airport.code), ['OKA'])
  const parsed = [{ from: 'HND', to: 'OKA', calendar: 'odpt.Calendar:Weekday', flights: [{ ...run('XX1', 600, 770), validFrom: '2026-10-25', validTo: '2027-03-27' }] }]
  const summary = timetableSummary([{}, {}], [[{}]], [...airports, { code: 'HND', name: '羽田', location: { lat: 35.55, lng: 139.78 } }], parsed, parsed)
  assert.equal(summary.airportRecords, 2)
  assert.equal(summary.hasOKA, true)
  assert.equal(summary.tokyoToNaha, 1)
  assert.deepEqual(summary.validTo, ['2027-03-27', '2027-03-27'])
})

test('ODPT：時刻表は航空会社 × 曜日に分けて読む（1 回 1000 件の上限で切れないように）', () => {
  const queries = scheduleQueries()
  assert.equal(queries.length, 14)
  assert.ok(queries.every((query) => query.startsWith('odpt:FlightSchedule?odpt:operator=') && query.includes('&odpt:calendar=odpt.Calendar%3A')))
  assert.ok(queries.some((query) => query.includes('ANA') && query.endsWith('Sunday')))
  assert.ok(queries.some((query) => query.includes('JAL') && query.endsWith('Monday')))
})

// ---- 押さなくても便が出る（かめの決定、2026-11-20、#482）。usecase と同じ形（searchingFlights の中で logic を呼ぶ）で確かめる
// 那覇より少し南。東京駅からは国際通りのほうが近いので、足すと国際通りのあとに入る
const PEACE_PARK = { lat: 26.097, lng: 127.725 }
const TOKYO_ORIGIN = { name: '東京駅', location: TOKYO_STATION, travelMode: 'transit' }
const NAHA = { id: 'naha', name: '国際通り', location: KOKUSAI_DORI, uid: 'u' }
const PARK = { id: 'park', name: '平和祈念公園', location: PEACE_PARK, uid: 'u' }
// 2026-11-19 は木曜日
const NAHA_DATE = '2026-11-19'
const NAHA_TIMETABLE = {
  airports: [
    { code: 'HND', name: '東京(羽田)', location: { lat: 35.5494, lng: 139.7798 } },
    { code: 'OKA', name: '那覇', location: { lat: 26.1958, lng: 127.6459 } },
  ],
  routes: [{ from: 'HND', to: 'OKA', calendar: 'odpt.Calendar:Thursday', flights: [run('XX1', at(11), at(13, 50)), run('XX2', at(15), at(17, 50)), run('XX3', at(19), at(21, 50))] }],
  fetchedAt: '2026-11-19T00:00:00.000Z',
}
/** 時刻表を読む口の偽物。読んだ回数を数える */
const loader = (timetable) => {
  const state = { calls: 0 }
  return Object.assign(async () => ((state.calls += 1), timetable), { state })
}
const numberOf = (leg) => leg?.flight?.numbers[0] ?? null

test('便を自動で探す：しおりを作ると、既定で飛行機になる区間に、押さなくても便が入る。飛行機の区間がなければ時刻表を読まない', async () => {
  const options = [{ style: 'shortest', catchphrase: '見本', pinIds: ['naha'] }]
  const input = { tripTitle: '沖縄', origin: TOKYO_ORIGIN, days: 1, places: [{ ...NAHA, category: 'town' }] }
  const load = loader(NAHA_TIMETABLE)
  const draft = await searchingFlights(load, async (search) => draftShiori(options, input, 'stub', search(input.origin, NAHA_DATE, undefined)))
  assert.equal(load.state.calls, 1)
  assert.equal(numberOf(draft.legFlights['@origin>naha']), 'XX1', '9:00 に東京駅を出て乗れる最初の便')
  assert.equal(draft.schedule[0].moveMinutesToNext, draft.legFlights['@origin>naha'].minutes)
  assert.equal(draft.legModes, undefined, '既定の飛行機は、区間の選択として残さない')
  // 飛行機の区間がない旅（東京駅 → 大阪駅）では、時刻表を読まず、便の欄も作らない
  const near = { ...input, places: [{ id: 'osaka', name: '大阪駅', location: OSAKA_STATION, uid: 'u', category: 'town' }] }
  const idle = loader(NAHA_TIMETABLE)
  const plain = await searchingFlights(idle, async (search) => draftShiori([{ ...options[0], pinIds: ['osaka'] }], near, 'stub', search(near.origin, NAHA_DATE, undefined)))
  assert.equal(idle.state.calls, 0)
  assert.equal('legFlights' in plain, false)
  assert.deepEqual(plain.schedule, draftShiori([{ ...options[0], pinIds: ['osaka'] }], near, 'stub').schedule)
})

test('便を自動で探す：場所を足す、入れ替える、消す、ほかの区間の手段を選ぶ、のどれでも、便の決まっていない飛行機の区間に便が入る', async () => {
  const searched = (attempt) => searchingFlights(loader(NAHA_TIMETABLE), async (search) => attempt((saved) => search(TOKYO_ORIGIN, NAHA_DATE, saved)))
  // 便を探す前に作ったしおり（便の欄がない）
  const route = { style: 'shortest', pinIds: ['naha'], revision: 0, addedPinIds: [] }
  // 足すときは 2 日の旅にする（東京から沖縄の日帰りに 2 か所は時間に収まらず、場所が外れるため。#622）
  const added = await searched((flights) => addToDecidedRoute(route, [NAHA, PARK], TOKYO_ORIGIN, 2, flights(route.legFlights)))
  assert.deepEqual(added.pinIds, ['naha', 'park'])
  assert.equal(numberOf(added.legFlights['@origin>naha']), 'XX1')
  // 入れ替えると、集合場所からの区間が別の区間（東京駅 → 平和祈念公園）になるので、その区間の便を探す
  const both = { ...route, pinIds: ['naha', 'park'], legModes: {}, legFlights: added.legFlights }
  const swapped = await searched((flights) => moveStop(both, [NAHA, PARK], TOKYO_ORIGIN, 1, 'naha', 'park', flights(both.legFlights)))
  assert.deepEqual(Object.keys(swapped.legFlights), ['@origin>park'])
  assert.equal(numberOf(swapped.legFlights['@origin>park']), 'XX1')
  // 国際通りを消しても同じ
  const removed = await searched((flights) => routeAfterRemoval(both, [PARK], TOKYO_ORIGIN, 1, 'naha', true, flights(both.legFlights)))
  assert.equal(numberOf(removed.update.legFlights['@origin>park']), 'XX1')
  // 国際通り → 平和祈念公園の区間で車を選んでも、便の決まっていない東京駅 → 那覇の便を探す
  const bare = { ...route, pinIds: ['naha', 'park'] }
  const car = await searched((flights) => routeWithLegMode(bare, [NAHA, PARK], TOKYO_ORIGIN, 1, 'naha', 'park', 'car', flights(bare.legFlights)))
  assert.deepEqual(car.legModes, { 'naha>park': 'car' })
  assert.equal(numberOf(car.legFlights['@origin>naha']), 'XX1')
  // 便は探したが乗れる便がなかった目安の区間も、組み直すたびに探し直す
  const estimated = { ...bare, legFlights: { '@origin>naha': { minutes: 300, flight: null, fetchedAt: null, departAt: at(9), day: 1 } } }
  const again = await searched((flights) => routeWithLegMode(estimated, [NAHA, PARK], TOKYO_ORIGIN, 1, 'naha', 'park', 'car', flights(estimated.legFlights)))
  assert.equal(numberOf(again.legFlights['@origin>naha']), 'XX1')
})

test('便を自動で探す：残してある便に乗れる区間は、組み直しても便を変えず、時刻表も読まない。乗れなくなった区間だけ探す', async () => {
  // XX2 を残してある（今の時刻表なら XX1 に乗れるが、変えない）
  const kept = { minutes: 600, flight: { numbers: ['XX2'], airline: 'ANA', from: { code: 'HND', name: '東京(羽田)' }, to: { code: 'OKA', name: '那覇' }, dep: '15:00', arr: '17:50' }, fetchedAt: 'x', departAt: at(9), day: 1 }
  const route = { style: 'shortest', pinIds: ['naha'], revision: 0, addedPinIds: [], legModes: {}, legFlights: { '@origin>naha': kept } }
  const load = loader(NAHA_TIMETABLE)
  const added = await searchingFlights(load, async (search) => addToDecidedRoute(route, [NAHA, PARK], TOKYO_ORIGIN, 2, search(TOKYO_ORIGIN, NAHA_DATE, route.legFlights)))
  assert.equal(load.state.calls, 0)
  assert.equal(numberOf(added.legFlights['@origin>naha']), 'XX2')
  // 入れ替える、消すでも、乗れる便が残る区間（東京駅 → 国際通り）は同じ便のまま、時刻表も読まない
  const three = { ...route, pinIds: ['naha', 'park', 'shuri'] }
  const SHURI = { id: 'shuri', name: '首里城', location: { lat: 26.217, lng: 127.7195 }, uid: 'u' }
  const quiet = loader(NAHA_TIMETABLE)
  const swapped = await searchingFlights(quiet, async (search) => moveStop(three, [NAHA, PARK, SHURI], TOKYO_ORIGIN, 1, 'park', 'shuri', search(TOKYO_ORIGIN, NAHA_DATE, three.legFlights)))
  assert.deepEqual(swapped.pinIds, ['naha', 'shuri', 'park'])
  assert.equal(numberOf(swapped.legFlights['@origin>naha']), 'XX2')
  const removed = await searchingFlights(quiet, async (search) => routeAfterRemoval(three, [NAHA, SHURI], TOKYO_ORIGIN, 1, 'park', true, search(TOKYO_ORIGIN, NAHA_DATE, three.legFlights)))
  assert.equal(numberOf(removed.update.legFlights['@origin>naha']), 'XX2')
  // ほかの区間（国際通り → 平和祈念公園）で車を選んでも同じ
  const two = { ...route, pinIds: ['naha', 'park'] }
  const car = await searchingFlights(quiet, async (search) => routeWithLegMode(two, [NAHA, PARK], TOKYO_ORIGIN, 1, 'naha', 'park', 'car', search(TOKYO_ORIGIN, NAHA_DATE, two.legFlights)))
  assert.deepEqual(car.legModes, { 'naha>park': 'car' })
  assert.equal(numberOf(car.legFlights['@origin>naha']), 'XX2')
  assert.equal(quiet.state.calls, 0)
  // 飛行機の区間がないしおり（那覇の集合場所から、近くの 3 か所）の組み直しでは、時刻表を読まない
  const local = { name: '那覇空港', location: { lat: 26.1958, lng: 127.6459 }, travelMode: 'car' }
  const plain = { style: 'shortest', pinIds: ['naha', 'park', 'shuri'], revision: 0, addedPinIds: [] }
  const none = await searchingFlights(quiet, async (search) => moveStop(plain, [NAHA, PARK, SHURI], local, 1, 'naha', 'shuri', search(local, NAHA_DATE, plain.legFlights)))
  assert.deepEqual(none.legFlights, {})
  assert.equal(quiet.state.calls, 0)
  // 出発を 14:00 に遅らせた形で組み直すと、15:00 発には手続きが間に合わないので、次の便を探す
  const late = { ...route, stopTimes: { '@origin': at(14) } }
  const lateLoad = loader(NAHA_TIMETABLE)
  const moved = await searchingFlights(lateLoad, async (search) => addToDecidedRoute(late, [NAHA, PARK], TOKYO_ORIGIN, 2, search(TOKYO_ORIGIN, NAHA_DATE, late.legFlights)))
  assert.equal(lateLoad.state.calls, 1)
  assert.equal(numberOf(moved.legFlights['@origin>naha']), 'XX3')
})

test('便を自動で探す：前提が変わる操作（時刻を直す、集合場所を変える、旅全体の手段を切り替える）では、乗れる便が残っていても決め直す', async () => {
  // 乗れる XX3（19:00 発）を残してある
  const kept = { minutes: 840, flight: { numbers: ['XX3'], airline: 'ANA', from: { code: 'HND', name: '東京(羽田)' }, to: { code: 'OKA', name: '那覇' }, dep: '19:00', arr: '21:50' }, fetchedAt: 'x', departAt: at(9), day: 1 }
  const route = { style: 'shortest', pinIds: ['naha'], revision: 0, legModes: {}, legFlights: { '@origin>naha': kept } }
  const replanned = (attempt, timetable = NAHA_TIMETABLE) => searchingFlights(loader(timetable), async (search) => attempt((origin) => search(origin, NAHA_DATE, route.legFlights, true)))
  const pins = [{ ...NAHA, status: 'done' }]
  const timed = await replanned((flights) => routeWithStopTime(route, [NAHA], TOKYO_ORIGIN, 1, '@origin', at(8), flights(TOKYO_ORIGIN)))
  assert.equal(numberOf(timed.legFlights['@origin>naha']), 'XX1')
  const omiya = { name: '大宮駅', location: OMIYA, travelMode: 'transit' }
  const moved = await replanned((flights) => routeWithOrigin(route, pins, omiya, 1, flights(omiya)))
  assert.equal(numberOf(moved.legFlights['@origin>naha']), 'XX2', '大宮駅を 9:00 に出ると 11:00 発には間に合わず、次の便になる')
  const byCar = { ...TOKYO_ORIGIN, travelMode: 'car' }
  const switched = await replanned((flights) => routeWithMode(route, pins, byCar, 1, flights(byCar)))
  assert.equal(numberOf(switched.legFlights['@origin>naha']), 'XX1')
  // 時刻表が取れないときは、残してある便をそのまま使う
  const offline = await replanned((flights) => routeWithMode(route, pins, byCar, 1, flights(byCar)), null)
  assert.equal(numberOf(offline.legFlights['@origin>naha']), 'XX3')
  // ただし集合場所を変えたときは、集合場所からの区間に残した便（前の集合場所から間に合う便）を外して目安にする
  const offlineMoved = await replanned((flights) => routeWithOrigin(route, pins, omiya, 1, flights(omiya)), null)
  assert.equal(offlineMoved.legFlights['@origin>naha'].flight, null)
  assert.equal(offlineMoved.schedule[0].moveMinutesToNext, estimatedFlightMinutes(OMIYA, KOKUSAI_DORI))
})

test('便を自動で探す：時刻表が取れないときは、距離の式の目安で組んで残す。ほかの失敗はそのまま伝える', async () => {
  const route = { style: 'shortest', pinIds: ['naha'], revision: 0, addedPinIds: [] }
  const load = loader(null)
  let runs = 0
  const added = await searchingFlights(load, async (search) => {
    runs += 1
    return addToDecidedRoute(route, [NAHA, PARK], TOKYO_ORIGIN, 2, search(TOKYO_ORIGIN, NAHA_DATE, route.legFlights))
  })
  assert.equal(runs, 2, '時刻表を読まずに 1 回、読んでから 1 回')
  assert.equal(load.state.calls, 1)
  const leg = added.legFlights['@origin>naha']
  assert.equal(leg.flight, null)
  assert.equal(leg.minutes, estimatedFlightMinutes(TOKYO_STATION, KOKUSAI_DORI))
  assert.equal(added.schedule[0].moveMinutesToNext, leg.minutes)
  await assert.rejects(searchingFlights(load, async () => { throw new Error('ほかの失敗') }), /ほかの失敗/)
  assert.equal(load.state.calls, 1, 'ほかの失敗では時刻表を読まない')
  // 時刻表を読んだあとの 2 回目で便を探す区間が出ても、もう読み直さない（繰り返さない）
  assert.ok(new TimetableNeeded() instanceof Error)
})

test('飛行機の旅：300 km 以上の区間は飛行機、近い区間と空港までは電車・バス', () => {
  const sendai = { lat: 38.2601, lng: 140.8822 }
  const kyoto = { lat: 34.98539, lng: 135.75879 }
  assert.equal(defaultLegMode(TOKYO_STATION, OSAKA_STATION, 'plane'), 'plane', '東京 → 大阪は約 400 km')
  assert.equal(defaultLegMode(OSAKA_STATION, kyoto, 'plane'), 'transit', '大阪 → 京都は近い')
  assert.equal(defaultLegMode(TOKYO_STATION, sendai, 'plane'), 'plane', '東京 → 仙台は約 300 km')
  // 車と電車・バスの旅は今までどおり
  assert.equal(defaultLegMode(TOKYO_STATION, OSAKA_STATION, 'car'), 'car')
  assert.equal(defaultLegMode(TOKYO_STATION, OSAKA_STATION, 'transit'), 'transit')
  assert.equal(groundMode('plane'), 'transit')
  assert.equal(groundMode('car'), 'car')
})
