// 発案者が旅の日程を変えたときの、しおりの組み直し（functions/src/domain/fitDays.ts、features/change-trip-dates）を、
// Emulator なしで確かめる。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { normalizeDates, decideChangeDates, routeWithDates, mealsWithin, MAX_TRIP_DAYS } = require('../functions/lib/features/change-trip-dates/logic.js')
const { addToDecidedRoute } = require('../functions/lib/features/propose-routes/logic.js')
const { routeAfterRemoval } = require('../functions/lib/features/remove-building/logic.js')
const { STYLE_TIMINGS } = require('../functions/lib/domain/routePlan.js')
const { measureTrip, OVER_ALLOWANCE_MINUTES } = require('../functions/lib/domain/dropToFit.js')

const TOKYO = { name: '東京駅', location: { lat: 35.68, lng: 139.77 }, travelMode: 'car', startDate: '2026-12-01' }
const place = (id, lat, lng, category = 'town') => ({ id, name: `場所 ${id}`, location: { lat, lng }, uid: 'a', category })
// 長野のあたりに、2 時間ずついる場所を 6 つ（3 日の旅なら 1 日 2〜3 か所）
const PLACES = [
  place('p1', 36.64, 138.19), place('p2', 36.65, 138.18), place('p3', 36.66, 138.2),
  place('p4', 36.67, 138.21), place('p5', 36.68, 138.22), place('p6', 36.69, 138.23),
]
const route = (pinIds, extra = {}) => ({ style: 'shortest', pinIds, revision: 0, addedPinIds: [], ...extra })
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

test('日程の形：帰る日は行く日より後。同じ日は日帰り、ない日と長すぎる旅は通さない', () => {
  assert.deepEqual(normalizeDates('2026-12-01', '2026-12-03'), { startDate: '2026-12-01', endDate: '2026-12-03' })
  assert.deepEqual(normalizeDates('2026-12-01', '2026-12-01'), { startDate: '2026-12-01', endDate: null })
  assert.deepEqual(normalizeDates('2026-12-01', null), { startDate: '2026-12-01', endDate: null })
  assert.equal(normalizeDates('2026-12-03', '2026-12-01'), null)
  assert.equal(normalizeDates('2026-02-30', null), null)
  assert.equal(normalizeDates('12/01', null), null)
  assert.equal(normalizeDates('2026-12-01', '2027-01-01'), null)
  assert.equal(MAX_TRIP_DAYS, 31)
})

test('日程を変えられるのは発案者だけで、確定中は発案者も変えられない', () => {
  const base = { isMember: true, isOwner: true, tripExists: true, confirmed: false, same: false }
  assert.equal(decideChangeDates(base), 'change')
  assert.equal(decideChangeDates({ ...base, isOwner: false }), 'not-owner')
  assert.equal(decideChangeDates({ ...base, isMember: false, isOwner: false }), 'not-member')
  assert.equal(decideChangeDates({ ...base, confirmed: true }), 'confirmed')
  assert.equal(decideChangeDates({ ...base, same: true }), 'unchanged')
})

test('縮めると、時間に収まるまで場所を外し、外した場所を leftOutPinIds に残す', () => {
  const ids = PLACES.map((item) => item.id)
  const next = routeWithDates(route(ids, { addedPinIds: ['p6'] }), PLACES, TOKYO, 1, true)
  assert.ok(next.leftOutPinIds.length > 0)
  // 残した場所と外した場所を合わせると、もとの場所すべて（重ならない）
  assert.deepEqual([...next.pinIds, ...next.leftOutPinIds].sort(), ids)
  assert.ok(next.schedule.every((stop) => stop.day === 1))
  assert.ok(measureTrip(TOKYO, 1, STYLE_TIMINGS.shortest)(next.pinIds.map((id) => PLACES.find((item) => item.id === id))).over <= OVER_ALLOWANCE_MINUTES)
  assert.ok(next.pinIds.length >= 1)
  assert.ok(next.addedPinIds.every((id) => next.pinIds.includes(id)))
  assert.equal(next.revision, 1)
})

test('縮めるとき、ゆとりのある日（宿の前の日）へ場所を入れ直し、延ばすと外した場所が戻る（バグ30）', () => {
  const inn1 = { ...place('inn1', 36.65, 138.19, 'lodging'), lodging: { want: 1 } }
  const inn2 = { ...place('inn2', 36.68, 138.22, 'lodging'), lodging: { want: 2 } }
  const all = [...PLACES, inn1, inn2]
  // 1 日目は p1 だけ（ゆとりが大きい）、2 日目と 3 日目に残りを詰めた 2 泊 3 日
  const ids = ['p1', 'inn1', 'p2', 'p3', 'inn2', 'p4', 'p5', 'p6']
  const saved = route(ids, { lodging: { 1: 'inn1', 2: 'inn2' } })
  const shorter = routeWithDates(saved, all, TOKYO, 2, true)
  // 1 日目のゆとりに入れ直すので、前の決め（最終日の後ろから外す）より外す場所が少ない。宿の前（1 日目）に場所が増える
  const firstDay = shorter.schedule.filter((stop) => stop.day === 1 && stop.pinId && stop.pinId !== 'inn1')
  assert.ok(firstDay.length >= 2, `1 日目に入れ直していない：${JSON.stringify(shorter.schedule.map((stop) => [stop.day, stop.pinId]))}`)
  assert.deepEqual(shorter.lodging, { 1: 'inn1' })
  assert.ok(shorter.leftOutPinIds.includes('inn2'))
  const leftPlaces = shorter.leftOutPinIds.filter((id) => id !== 'inn2')
  assert.ok(leftPlaces.length <= 1, `外しすぎ：${shorter.leftOutPinIds}`)

  // 2 泊 3 日に戻すと、外した場所（日程の外になった夜の宿も）がしおりに戻る
  const longer = routeWithDates({ ...saved, ...shorter }, all, TOKYO, 3, false)
  assert.deepEqual(longer.leftOutPinIds, [])
  assert.deepEqual([...longer.pinIds].sort(), [...ids].sort())
  assert.deepEqual(longer.lodging, { 1: 'inn1', 2: 'inn2' })
  assert.ok(longer.schedule.some((stop) => stop.day === 3), '3 日目が空のまま')
})

test('日程を変えても、時間に収まらない場所は戻さない', () => {
  const ids = PLACES.map((item) => item.id)
  const shorter = routeWithDates(route(ids), PLACES, TOKYO, 1, true)
  // 日帰りのまま日付だけ動かしても、外した場所は収まらないので戻らない
  const shifted = routeWithDates({ ...route(ids), ...shorter }, PLACES, { ...TOKYO, startDate: '2026-12-10' }, 1, false)
  assert.deepEqual([...shifted.leftOutPinIds].sort(), [...shorter.leftOutPinIds].sort())
})

test('延ばしたときと、日数が同じときは、場所を外さない', () => {
  const ids = PLACES.map((item) => item.id)
  const longer = routeWithDates(route(ids), PLACES, TOKYO, 4, false)
  assert.deepEqual(longer.pinIds, ids)
  assert.equal(longer.leftOutPinIds, undefined)
  const shifted = routeWithDates(route(ids), PLACES, { ...TOKYO, startDate: '2026-12-10' }, 3, false)
  assert.deepEqual(shifted.pinIds, ids)
})

test('縮めて消えた夜の宿は外し、残る夜の宿は残す', () => {
  const inn1 = { ...place('inn1', 36.65, 138.19, 'lodging'), lodging: { want: 1 } }
  const inn2 = { ...place('inn2', 36.68, 138.22, 'lodging'), lodging: { want: 2 } }
  const all = [PLACES[0], inn1, PLACES[1], inn2, PLACES[2]]
  const saved = route(['p1', 'inn1', 'p2', 'inn2', 'p3'], { lodging: { 1: 'inn1', 2: 'inn2' } })
  const next = routeWithDates(saved, all, TOKYO, 2, true)
  assert.ok(next.leftOutPinIds.includes('inn2'))
  assert.ok(!next.pinIds.includes('inn2'))
  assert.deepEqual(next.lodging, { 1: 'inn1' })
})

test('開催日が新しい日程の外になったイベントは外す', () => {
  const fireworks = { ...place('fw', 36.66, 138.2, 'nightview'), event: { kind: 'fireworks', date: '2026-12-03', start: 19 * 60 + 30, end: 20 * 60 + 30, leadMinutes: 60, source: '見本' } }
  const next = routeWithDates(route(['p1', 'fw']), [PLACES[0], fireworks], TOKYO, 2, true)
  assert.deepEqual(next.pinIds, ['p1'])
  assert.deepEqual(next.leftOutPinIds, ['fw'])
})

test('外した場所は、あとで建った場所を足すときに戻らない。建物を消すと印も消える', () => {
  const saved = route(['p1', 'p2'], { leftOutPinIds: ['p3'] })
  // 新しく建った p4 だけが足され、外した p3 は足さない
  const added = addToDecidedRoute(saved, PLACES.slice(0, 4), TOKYO, 2)
  assert.ok(added.pinIds.includes('p4'))
  assert.ok(!added.pinIds.includes('p3'))
  assert.equal(addToDecidedRoute(saved, PLACES.slice(0, 3), TOKYO, 2), null)

  assert.deepEqual(routeAfterRemoval(saved, PLACES.slice(0, 2), TOKYO, 2, 'p3', true), { kind: 'update', update: { leftOutPinIds: [] } })
})

test('縮めると、日程を越える日のごはんの枠と、外したお店の枠を消す', () => {
  const meals = { '1-lunch': 'p1', '2-lunch': 'p2', '2-dinner': '@skip:コンビニ', '3-dinner': 'p3' }
  assert.deepEqual(mealsWithin(meals, 2, ['p2']), { '1-lunch': 'p1', '2-dinner': '@skip:コンビニ' })
  const next = routeWithDates(route(['p1', 'p2'], { meals: { '1-lunch': 'p1', '3-dinner': 'p2' } }), PLACES.slice(0, 2), TOKYO, 1, true)
  assert.deepEqual(next.meals, { '1-lunch': 'p1' })
})

test('前の夜と同じ宿にしたしおりを縮めると、日程の外の夜の複製した宿の行だけを消し、宿の建物は外した場所に数えない（#642 のレビュー）', () => {
  const { routeWithSameLodging } = require('../functions/lib/features/set-lodging/logic.js')
  const inn = { ...place('inn', 36.645, 138.195, 'lodging'), lodging: { want: 1 } }
  const places = [PLACES[0], inn, PLACES[1], PLACES[2], PLACES[3]]
  const base = route(['p1', 'inn', 'p2', 'p3', 'p4'], { lodging: { 1: 'inn' } })
  const two = routeWithSameLodging(base, places, TOKYO, 3, 2)
  const copy = two.lodging['2']
  assert.match(copy, /^inn~\d+$/)
  const shorter = routeWithDates({ ...base, ...two }, places, TOKYO, 2, false)
  assert.ok(!shorter.pinIds.includes(copy), '日程の外の夜の、複製した宿の行が残った')
  assert.ok(shorter.pinIds.includes('inn'), '1 日目の夜の宿まで消えた')
  assert.deepEqual(shorter.lodging, { 1: 'inn' })
  assert.ok(!(shorter.leftOutPinIds ?? []).includes('inn'))
})

test('しおりに戻す：外した場所を、時間に収まらなくても戻し、外した印を消す（バグ30）', () => {
  const { routeWithPlaceBack } = require('../functions/lib/features/restore-place/logic.js')
  const ids = PLACES.map((item) => item.id)
  const shorter = routeWithDates(route(ids), PLACES, TOKYO, 1, true)
  const target = shorter.leftOutPinIds[0]
  const back = routeWithPlaceBack({ ...route(ids), ...shorter }, PLACES, TOKYO, 1, target)
  assert.ok(back.pinIds.includes(target))
  assert.ok(!back.leftOutPinIds.includes(target))
  assert.equal(back.leftOutPinIds.length, shorter.leftOutPinIds.length - 1)
  // ほかの場所は外さない
  for (const id of shorter.pinIds) assert.ok(back.pinIds.includes(id))
  assert.ok(back.addedPinIds.includes(target))
  // 外した印がなければ、何も変えない
  assert.equal(routeWithPlaceBack({ ...route(ids), ...shorter }, PLACES, TOKYO, 1, shorter.pinIds[0]), null)
})

test('しおりに戻す：日程の外の夜で外した宿は、空いている夜の宿に戻る', () => {
  const { routeWithPlaceBack } = require('../functions/lib/features/restore-place/logic.js')
  const inn = { ...place('inn', 36.65, 138.19, 'lodging'), lodging: { want: 2 } }
  const all = [...PLACES.slice(0, 4), inn]
  const saved = route(['p1', 'p2', 'p3', 'p4'], { leftOutPinIds: ['inn'] })
  const back = routeWithPlaceBack(saved, all, TOKYO, 2, 'inn')
  assert.deepEqual(back.lodging, { 1: 'inn' })
  assert.deepEqual(back.leftOutPinIds, [])
})

test('前の決め（最終日の後ろから外す）で外した場所も、延ばすと戻る（バグ30）', () => {
  const inn1 = { ...place('inn1', 36.65, 138.19, 'lodging'), lodging: { want: 1 } }
  const inn2 = { ...place('inn2', 36.68, 138.22, 'lodging'), lodging: { want: 2 } }
  const all = [...PLACES, inn1, inn2]
  const old = route(['p1', 'inn1', 'p2'], { lodging: { 1: 'inn1' }, leftOutPinIds: ['inn2', 'p6', 'p5', 'p4', 'p3'] })
  const longer = routeWithDates(old, all, TOKYO, 3, false)
  assert.deepEqual(longer.leftOutPinIds, [])
  assert.equal(longer.lodging['2'], 'inn2')
  assert.ok(longer.schedule.some((stop) => stop.day === 3 && stop.pinId), '3 日目が空のまま')
})

test('日程の外の夜で外した宿は、空いた夜がなければ、日付を動かしても日中の場所として戻らない（PR #749 のレビュー）', () => {
  const inn1 = { ...place('inn1', 36.65, 138.19, 'lodging'), lodging: { want: 1 } }
  const inn2 = { ...place('inn2', 36.68, 138.22, 'lodging'), lodging: { want: 2 } }
  const all = [...PLACES.slice(0, 3), inn1, inn2]
  const saved = route(['p1', 'inn1', 'p2', 'p3'], { lodging: { 1: 'inn1' }, leftOutPinIds: ['inn2'] })
  const shifted = routeWithDates(saved, all, { ...TOKYO, startDate: '2026-12-10' }, 2, false)
  assert.ok(!shifted.pinIds.includes('inn2'))
  assert.deepEqual(shifted.leftOutPinIds, ['inn2'])
  assert.deepEqual(shifted.lodging, { 1: 'inn1' })
})
