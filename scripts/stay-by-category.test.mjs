// しおりのいる時間を場所の種類ごとの目安にし、日を時間で分ける決め（functions/src/domain/routePlan.ts の stayMinutesFor・dayPacker・
// splitByNights・buildPlan、#520）を、Emulator なしで確かめる。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const {
  buildPlan,
  CATEGORY_STAY_MINUTES,
  DAY_END_MINUTES,
  LODGING_ARRIVE_MINUTES,
  nightStartMinutes,
  planPlace,
  splitByNights,
  dayPacker,
  stayMinutesFor,
  STYLE_TIMINGS,
} = require(
  '../functions/lib/domain/routePlan.js',
)

// 松本のまわりの近い場所。松本駅から車で回る
const ORIGIN = { name: '松本駅', location: { lat: 36.2308, lng: 137.9644 }, travelMode: 'car' }
const at = (id, lat, lng, category) => ({ id, name: id, location: { lat, lng }, uid: 'u1', category })
const CASTLE = at('castle', 36.2386, 137.9689, 'shrine')
const SOBA = at('soba', 36.235, 137.97, 'food')
const ONSEN = at('onsen', 36.207, 138.0, 'onsen')
const TOWN = at('town', 36.233, 137.965, 'town')
const SKI = at('ski', 36.7, 137.83, 'ski')
const INN = { ...at('inn', 36.23, 137.97, 'lodging'), lodging: { want: null } }
const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const days = (plan) => plan.schedule.filter((stop) => stop.pinId).map((stop) => [stop.pinId, stop.day])

test('いる時間：場所の種類ごとの目安。ゆったり案は ×1.25 を 15 分きざみ。種類がなければ一律の分数', () => {
  const shortest = STYLE_TIMINGS.shortest
  // スキー場は最低 4 時間。着く時刻が分かれば、16 時まで（#602）
  assert.equal(stayMinutesFor(SKI, shortest), 4 * 60)
  assert.equal(stayMinutesFor(SKI, shortest, 10 * 60), 6 * 60)
  assert.equal(stayMinutesFor(SKI, shortest, 13 * 60), 4 * 60)
  assert.equal(stayMinutesFor(SKI, STYLE_TIMINGS.relaxed, 13 * 60), 5 * 60)
  // 遊ぶところは終日。水族館と動物園は 2 時間半（名前で見分ける）
  assert.equal(stayMinutesFor({ category: 'themepark', name: 'テーマパーク' }, shortest), 7 * 60)
  assert.equal(stayMinutesFor({ category: 'themepark', name: '沖縄美ら海水族館' }, shortest), 150)
  assert.equal(stayMinutesFor({ category: 'themepark', name: '旭山動物園' }, shortest), 150)
  assert.equal(stayMinutesFor(ONSEN, shortest), 120)
  assert.equal(stayMinutesFor(CASTLE, shortest), 90)
  assert.equal(stayMinutesFor(SOBA, shortest), 60)
  // ゆったり：90 × 1.25 = 112.5 → 120、60 × 1.25 = 75
  assert.equal(stayMinutesFor(CASTLE, STYLE_TIMINGS.relaxed), 120)
  assert.equal(stayMinutesFor(SOBA, STYLE_TIMINGS.relaxed), 75)
  // 終日でも、1 日の持ち時間（始まり〜19 時）を越えない
  assert.ok(stayMinutesFor(SKI, { startMinutes: 13 * 60, stayMinutes: 60, stayScale: 1.25 }) <= DAY_END_MINUTES - 13 * 60)
  // 種類が分からない、または倍率のない時間の決めなら、一律の分数
  assert.equal(stayMinutesFor({}, shortest), 60)
  assert.equal(stayMinutesFor(SKI, { startMinutes: 9 * 60, stayMinutes: 45 }), 45)
  // 種類ごとの目安は、どの種類にもある
  for (const value of Object.values(CATEGORY_STAY_MINUTES)) assert.ok(value > 0)
})

test('いる時間：しおりの行は、場所の種類で長さが変わる', () => {
  const plan = buildPlan([SOBA, ONSEN], ORIGIN, 1, STYLE_TIMINGS.shortest)
  const stayOf = (id) => plan.schedule.find((stop) => stop.pinId === id).stayMinutes
  assert.equal(stayOf('soba'), 60)
  assert.equal(stayOf('onsen'), 120)
})

test('日の分け方：2 泊 3 日で場所が少なくても、19 時までに入る軽い予定は 1 日目にまとめる（1 日 1 予定にしない）', () => {
  const plan = buildPlan([CASTLE, SOBA, ONSEN], ORIGIN, 3, STYLE_TIMINGS.shortest)
  assert.deepEqual(days(plan), [['castle', 1], ['soba', 1], ['onsen', 1]])
  // 最後の場所を出るのは 19 時まで
  const last = plan.schedule.at(-1)
  assert.ok(minutesOf(last.time) + last.stayMinutes <= DAY_END_MINUTES)
})

test('日の分け方：19 時を越える場所から次の日に回し、次の日は前の日の最後の場所から移動して始まる', () => {
  // 松本城 90、街歩き 120、温泉 120、そば 60、また街歩き 120 …と重ねると、どこかで 19 時を越える
  const order = [CASTLE, TOWN, ONSEN, SOBA, at('town2', 36.234, 137.966, 'town'), at('onsen2', 36.21, 138.0, 'onsen')]
  const plan = buildPlan(order, ORIGIN, 2, STYLE_TIMINGS.shortest)
  const day1 = plan.schedule.filter((stop) => stop.day === 1 && stop.pinId)
  const day2 = plan.schedule.filter((stop) => stop.day === 2)
  assert.ok(day1.length >= 2 && day2.length >= 1)
  const lastOfDay1 = day1.at(-1)
  assert.ok(minutesOf(lastOfDay1.time) + lastOfDay1.stayMinutes <= DAY_END_MINUTES)
  // 宿を取らない夜の翌朝は、前の日の最後の場所から移動する（#602）
  assert.equal(minutesOf(day2[0].time), 9 * 60 + lastOfDay1.moveMinutesToNext)
  // 順番は変えない
  assert.deepEqual(plan.schedule.filter((stop) => stop.pinId).map((stop) => stop.pinId), order.map((place) => place.id))
})

test('日の分け方：スキー場は 10 時ごろから最低 4 時間。あとに予定がなければ 16 時まで。12 時より遅く着くなら、ほかの場所のある日は翌日に回す', () => {
  // 午前に軽い予定を入れても、12 時までに着けば同じ日に滑る。あとに予定がないので 16 時まで
  const morning = buildPlan([SOBA, SKI], ORIGIN, 2, STYLE_TIMINGS.shortest)
  assert.deepEqual(days(morning), [['soba', 1], ['ski', 1]])
  const ski = morning.schedule.find((stop) => stop.pinId === 'ski')
  assert.ok(minutesOf(ski.time) <= 12 * 60)
  assert.equal(minutesOf(ski.time) + ski.stayMinutes, 16 * 60)
  // あとに予定があれば、最低の 4 時間で次へ行く
  const after = buildPlan([SKI, CASTLE, SOBA], ORIGIN, 2, STYLE_TIMINGS.shortest)
  assert.equal(after.schedule.find((stop) => stop.pinId === 'ski').stayMinutes, 4 * 60)
  assert.deepEqual(days(after), [['ski', 1], ['castle', 1], ['soba', 1]])
  // 午前の予定が長く、12 時より遅く着くなら、スキー場は翌朝に回る
  const late = buildPlan([CASTLE, ONSEN, TOWN, SKI], ORIGIN, 2, STYLE_TIMINGS.shortest)
  assert.equal(late.schedule.find((stop) => stop.pinId === 'ski').day, 2)
})

test('夜景は夜：その日の最後（宿の前）に置き、日の入りの 30 分後より前には着かない。19 時の枠に数えない', () => {
  // 12 月の日の入りは 16:30 ごろ → 17:00 から。6 月は 19:00 ごろ → 19:30 から。開始日がなければ 18 時
  assert.equal(nightStartMinutes('2026-12-05', 1), 17 * 60)
  assert.equal(nightStartMinutes('2026-06-10', 1), 19 * 60 + 30)
  assert.equal(nightStartMinutes('2026-11-30', 2), 17 * 60)
  assert.equal(nightStartMinutes(undefined, 1), 18 * 60)
  const winter = { ...ORIGIN, startDate: '2026-12-05' }
  const NIGHT = at('night', 36.25, 137.98, 'nightview')
  // 順番の先頭にあっても、その日の最後（宿の前）に回り、17 時に着く
  const plan = buildPlan([NIGHT, CASTLE, SOBA, INN, ONSEN], winter, 2, { ...STYLE_TIMINGS.shortest, lodging: { 1: 'inn' } })
  assert.deepEqual(days(plan), [['castle', 1], ['soba', 1], ['night', 1], ['inn', 1], ['onsen', 2]])
  const night = plan.schedule.find((stop) => stop.pinId === 'night')
  assert.equal(night.time, '17:00')
  assert.equal(night.evening, true)
  // 保存する順番も、しおりの行の順にそろう
  assert.deepEqual(plan.pinIds, ['castle', 'soba', 'night', 'inn', 'onsen'])
  // ゆとりは、そばを出てから、夜景へ向かう前まで
  const [day1] = daySlacks(plan, 2, 9 * 60)
  const soba = plan.schedule.find((stop) => stop.pinId === 'soba')
  assert.equal(day1.from, minutesOf(soba.time) + soba.stayMinutes)
  assert.equal(day1.to, 17 * 60 - soba.moveMinutesToNext)
})

test('宿のある日：宿に 19 時に着くように入れ、間に合わない場所は翌朝（宿のあと）へ回す', () => {
  // 東京から松本へ。1 泊目の宿の前に 4 か所。ゆったり案だと全部は入らない
  const FAR = { ...ORIGIN, name: '東京駅', location: { lat: 35.68, lng: 139.77 } }
  const order = [CASTLE, ONSEN, TOWN, at('farm', 36.3, 137.9, 'farm'), INN, SOBA]
  const plan = buildPlan(order, FAR, 2, { ...STYLE_TIMINGS.relaxed, lodging: { 1: 'inn' } })
  const inn = plan.schedule.find((stop) => stop.pinId === 'inn')
  assert.equal(inn.day, 1)
  assert.ok(minutesOf(inn.time) <= LODGING_ARRIVE_MINUTES, `宿に ${inn.time} に着く`)
  // 回した場所は 2 日目の頭。保存する順番も宿のあとになる
  const day2 = plan.schedule.filter((stop) => stop.day === 2 && stop.pinId).map((stop) => stop.pinId)
  assert.ok(day2.length >= 2 && day2.at(-1) === 'soba')
  assert.deepEqual(plan.pinIds, plan.schedule.filter((stop) => stop.pinId).map((stop) => stop.pinId))
  assert.ok(plan.pinIds.indexOf('inn') < plan.pinIds.indexOf(day2[0]))
})

test('日の分け方：前から詰めたあと、場所のある日どうしでゆとりをならす', () => {
  // 松本のまわりの 5 か所を 2 日で。前から詰めるだけなら、1 日目に 4 か所（17 時台に出る）、2 日目に 1 か所になる。
  // ならすと 3 か所と 2 か所（2 日目は旅の最後の日で、帰りの移動のぶん終わりが早い）
  const five = [CASTLE, TOWN, ONSEN, at('town2', 36.234, 137.966, 'town'), at('onsen2', 36.21, 138.0, 'onsen')]
  const parts = dayPacker(ORIGIN, STYLE_TIMINGS.shortest)(five, 2, null, true, 1, null)
  assert.deepEqual(parts.map((part) => part.map((place) => place.id)), [['castle', 'town', 'onsen'], ['town2', 'onsen2']])
  // しおりでも同じ分け方で、どちらの日にもゆとりが残る
  const plan = buildPlan(five, ORIGIN, 2, STYLE_TIMINGS.shortest)
  assert.deepEqual(days(plan).map(([, day]) => day), [1, 1, 1, 2, 2])
  const [day1, day2] = daySlacks(plan, 2, 9 * 60)
  assert.ok(Math.min(day1.minutes, day2.minutes) >= 30, `ゆとり ${day1.minutes} 分と ${day2.minutes} 分`)
})

test('宿のある日：宿に間に合わない場所を宿のあとへ回しても、時刻の決まったイベントは開催日に残す', () => {
  // 金曜の夜の花火（19:30〜）の日に宿。ゆったり案で昼の場所が多く、農園は宿に間に合わない
  const friday = { ...ORIGIN, startDate: '2026-11-27' }
  const fireworks = { kind: 'fireworks', date: '2026-11-27', start: 19 * 60 + 30, end: 20 * 60 + 30, leadMinutes: 60, source: '見本' }
  const FW = { ...at('fw', 36.05, 138.09, 'nightview'), event: fireworks }
  const FARM = at('farm', 36.3, 137.9, 'farm')
  const plan = buildPlan([CASTLE, ONSEN, TOWN, FARM, FW, INN, SOBA], friday, 2, { ...STYLE_TIMINGS.relaxed, lodging: { 1: 'inn' } })
  assert.equal(plan.schedule.find((stop) => stop.pinId === 'fw').day, 1)
  assert.equal(plan.schedule.find((stop) => stop.pinId === 'fw').time, '18:30')
  assert.deepEqual(days(plan), [['castle', 1], ['onsen', 1], ['town', 1], ['fw', 1], ['inn', 1], ['farm', 2], ['soba', 2]])
})

test('組み直す機能も、しおりの行の順の pinIds を保存する（前の形で、夜景が日の途中にあるしおり）', () => {
  const { routeWithMode } = require('../functions/lib/features/change-travel-mode/logic.js')
  const winter = { ...ORIGIN, startDate: '2026-12-05' }
  const pin = (place) => ({ id: place.id, name: place.name, location: place.location, uid: place.uid, category: place.category })
  const NIGHT = at('night', 36.25, 137.98, 'nightview')
  const route = { style: 'shortest', pinIds: ['night', 'castle', 'soba'], revision: 0 }
  const update = routeWithMode(route, [NIGHT, CASTLE, SOBA].map(pin), { ...winter, travelMode: 'transit' }, 1)
  assert.deepEqual(update.pinIds, ['castle', 'soba', 'night'])
  assert.deepEqual(update.schedule.filter((stop) => stop.pinId).map((stop) => stop.pinId), update.pinIds)
})

test('日の分け方：最後の日には、入らなくても残りを全部入れる（日帰りで場所を落とさない）', () => {
  const plan = buildPlan([SKI, at('ski2', 36.75, 137.85, 'ski'), CASTLE], ORIGIN, 1, STYLE_TIMINGS.shortest)
  assert.deepEqual(days(plan), [['ski', 1], ['ski2', 1], ['castle', 1]])
})

test('日の分け方：宿の夜があっても、宿の日が宿だけにならない（区間の最後の場所を宿の日へ回す）', () => {
  // 2 日目の夜の宿。宿までの 2 か所は 1 日目に入るが、2 日目が宿だけにならないよう、そばを 2 日目に回す
  const order = [CASTLE, SOBA, INN, ONSEN]
  const pack = dayPacker(ORIGIN, STYLE_TIMINGS.shortest)
  const { groups } = splitByNights(order, 3, { 2: 'inn' }, pack)
  assert.deepEqual(groups.map((group) => [group.day, group.places.map((place) => place.id)]), [[1, ['castle']], [2, ['soba', 'inn']], [3, ['onsen']]])
  // 宿の前が 1 か所だけなら、前の日を空にしないよう、そのまま（宿だけの日になる）
  const single = splitByNights([CASTLE, INN], 3, { 2: 'inn' }, pack)
  assert.deepEqual(single.groups.map((group) => [group.day, group.places.map((place) => place.id)]), [[1, ['castle']], [2, ['inn']]])
  // しおりでも同じ。宿の行は 2 日目の最後
  const plan = buildPlan(order, ORIGIN, 3, { ...STYLE_TIMINGS.shortest, lodging: { 2: 'inn' } })
  assert.deepEqual(days(plan), [['castle', 1], ['soba', 2], ['inn', 2], ['onsen', 3]])
})

test('場所を作る関数：種類と宿の印を渡す（どの組み直しでも、いる時間が変わらないように）', () => {
  const pin = { name: '旅館', location: { lat: 36, lng: 138 }, uid: 'u1', category: 'lodging', lodgingNight: 2 }
  assert.deepEqual(planPlace('p1', pin), { id: 'p1', name: '旅館', location: { lat: 36, lng: 138 }, uid: 'u1', category: 'lodging', lodging: { want: 2 } })
  const plain = planPlace('p2', { name: '城', location: { lat: 36, lng: 138 }, uid: 'u1', category: 'shrine' })
  assert.equal(plain.category, 'shrine')
  assert.equal('lodging' in plain, false)
})

// ---- 空いた時間（domain/slack.ts）と、空きへの提案（features/suggest-fillers） ----

const { daySlacks, FILL_MIN_MINUTES, KEEP_SLACK_MINUTES } = require('../functions/lib/domain/slack.js')
const { FILLER_RADIUS_KM, fillerPinId, planFillers } = require('../functions/lib/features/suggest-fillers/logic.js')
const { isOpenFiller } = require('../functions/lib/domain/pin.js')
const { CATALOGUE } = require('../functions/lib/domain/catalogue.js')

test('空いた時間：その日の最後の場所を出てから 19 時まで。行のない日は、まるごと空き。旅の最後の日は、帰りの移動を引く', () => {
  const plan = buildPlan([CASTLE, SOBA], ORIGIN, 3, STYLE_TIMINGS.shortest)
  const slacks = daySlacks(plan, 3, 9 * 60)
  assert.equal(slacks.length, 3)
  const last = plan.schedule.at(-1)
  assert.equal(slacks[0].from, minutesOf(last.time) + last.stayMinutes)
  assert.equal(slacks[0].minutes, DAY_END_MINUTES - slacks[0].from)
  assert.equal(slacks[0].anchorPinId, 'soba')
  assert.equal(slacks[0].empty, false)
  // 2 日目と 3 日目は行がない：9 時から 19 時まで、前の日の最後の場所の近く
  // 3 日目は旅の最後の日なので、19 時から出発地（松本駅）へ帰る移動を引く。最後の場所の行に、帰りの移動の目安がある（#602）
  assert.ok(last.returnMinutes > 0)
  assert.deepEqual(slacks.slice(1).map((slack) => [slack.day, slack.from, slack.minutes, slack.anchorPinId, slack.empty]), [
    [2, 9 * 60, 10 * 60, 'soba', true],
    [3, 9 * 60, 10 * 60 - last.returnMinutes, 'soba', true],
  ])
  // 日帰りなら、その日のゆとりから帰りの移動を引く
  const dayTrip = buildPlan([CASTLE, SOBA], ORIGIN, 1, STYLE_TIMINGS.shortest)
  const [only] = daySlacks(dayTrip, 1, 9 * 60)
  assert.equal(only.to, DAY_END_MINUTES - dayTrip.schedule.at(-1).returnMinutes)
})

test('空いた時間：web の daySlacks も、Functions と同じ結果を返す（夜景、宿、帰りの移動）', async () => {
  const web = await import('../web/src/entities/route/model/slack.ts')
  const winter = { ...ORIGIN, startDate: '2026-12-05', location: { lat: 35.68, lng: 139.77 } }
  const NIGHT = at('night', 36.25, 137.98, 'nightview')
  const lodging = { 1: 'inn' }
  const plan = buildPlan([CASTLE, NIGHT, SOBA, INN, ONSEN, TOWN], winter, 3, { ...STYLE_TIMINGS.shortest, lodging })
  const route = { ...plan, lodging, style: 'shortest' }
  const pick = (slack) => [slack.day, slack.from, slack.to, slack.minutes, slack.empty]
  assert.deepEqual(web.daySlacks(route, 3).map(pick), daySlacks(route, 3, 9 * 60).map(pick))
})

test('空いた時間：宿の日は、宿の前の場所を出てから、宿へ移動して 19 時に着くまで（宿に着いてからは空きにしない）', () => {
  const plan = buildPlan([CASTLE, SOBA, INN, ONSEN], ORIGIN, 3, { ...STYLE_TIMINGS.shortest, lodging: { 2: 'inn' } })
  const [, day2] = daySlacks(plan, 3, 9 * 60)
  const soba = plan.schedule.find((stop) => stop.pinId === 'soba')
  assert.equal(day2.from, minutesOf(soba.time) + soba.stayMinutes)
  assert.equal(day2.to, LODGING_ARRIVE_MINUTES - soba.moveMinutesToNext)
  assert.equal(day2.anchorPinId, 'soba')
})

const fillerInput = (overrides = {}) => {
  const plan = buildPlan([CASTLE], ORIGIN, 2, STYLE_TIMINGS.shortest)
  return {
    slacks: daySlacks(plan, 2, 9 * 60),
    locationOf: (id) => (id === 'castle' ? CASTLE.location : undefined),
    takenNames: new Set(['castle']),
    allowed: null,
    catalogue: [
      { name: '近くの温泉', pref: '長野県', city: '松本市', category: 'onsen', description: '', lat: 36.21, lng: 138.0 },
      { name: '近くの宿', pref: '長野県', city: '松本市', category: 'lodging', description: '', lat: 36.24, lng: 137.97 },
      { name: '遠くの寺', pref: '京都府', city: '京都市', category: 'shrine', description: '', lat: 35.0, lng: 135.77 },
      { name: '近くの城下町', pref: '長野県', city: '松本市', category: 'town', description: '', lat: 36.24, lng: 137.97 },
      { name: '近くの遊園地', pref: '長野県', city: '松本市', category: 'themepark', description: '', lat: 36.25, lng: 137.98 },
    ],
    timing: STYLE_TIMINGS.shortest,
    travelMode: 'car',
    open: [],
    enabled: true,
    ...overrides,
  }
}

test('空きへの提案：2 時間以上空いた日に 1 つ。近い順で、宿と遠い場所は選ばない', () => {
  const { create, remove } = planFillers(fillerInput())
  assert.deepEqual(remove, [])
  // 1 日目（松本城のあと）と 2 日目（まるごと空き）に 1 つずつ。同じ場所は 2 回選ばない
  assert.deepEqual(create.map((draft) => [draft.day, draft.entry.name]), [[1, '近くの城下町'], [2, '近くの遊園地']])
  assert.equal(create[0].id, fillerPinId(1, 3))
  assert.ok(create.every((draft) => draft.entry.category !== 'lodging'))
})

test('空きへの提案：入れても 1 時間のゆとりが残る場所だけ。空きが 2 時間未満の日には出さない', () => {
  // 1 日目の空きを 3 時間にする：街歩き（2 時間）＋行き帰り＋ゆとり 1 時間は入らず、温泉（2 時間）も入らない
  const input = fillerInput()
  const slacks = [{ day: 1, from: 16 * 60, minutes: 3 * 60, anchorPinId: 'castle', empty: false }, { day: 2, from: 18 * 60, minutes: FILL_MIN_MINUTES - 1, anchorPinId: 'castle', empty: false }]
  const { create } = planFillers({ ...input, slacks, catalogue: [...input.catalogue, { name: '近くのそば', pref: '長野県', city: '松本市', category: 'food', description: '', lat: 36.236, lng: 137.97 }] })
  assert.deepEqual(create.map((draft) => [draft.day, draft.entry.name]), [[1, '近くのそば']])
  assert.ok(60 + KEEP_SLACK_MINUTES <= 3 * 60)
})

test('空きへの提案：旅にある名前（無視した提案も）と、旅の地方の外は選ばない。今ある提案が入るならそのまま', () => {
  const taken = planFillers(fillerInput({ takenNames: new Set(['近くの城下町', '近くの遊園地', '近くの温泉']) }))
  assert.deepEqual(taken.create, [])
  const outside = planFillers(fillerInput({ allowed: new Set(['京都府']) }))
  assert.deepEqual(outside.create, [])
  // 1 日目に今ある提案（入る）は残し、新しく立てない。2 日目の今ある提案が遠すぎるなら消して立て直す
  const open = [
    { id: 'filler-1-0', day: 1, name: '近くの温泉', category: 'onsen', location: { lat: 36.21, lng: 138.0 } },
    { id: 'filler-2-2', day: 2, name: '遠くの寺', category: 'shrine', location: { lat: 35.0, lng: 135.77 } },
  ]
  const kept = planFillers(fillerInput({ open, takenNames: new Set(['castle', '近くの温泉', '遠くの寺']) }))
  assert.deepEqual(kept.remove, ['filler-2-2'])
  assert.deepEqual(kept.create.map((draft) => [draft.day, draft.entry.name]), [[2, '近くの城下町']])
  // 提案してはいけないとき（確定、上限、しおりなし）は、立てずに全部消す
  const off = planFillers(fillerInput({ open, enabled: false }))
  assert.deepEqual(off, { create: [], remove: ['filler-1-0', 'filler-2-2'] })
  assert.ok(FILLER_RADIUS_KM > 0)
})

test('空きへの提案：見本の一覧の場所は、宿の行き先にならない種類を含み、まだ無視も建築もされていない提案だけが開いている', () => {
  assert.ok(CATALOGUE.some((entry) => entry.category !== 'lodging'))
  assert.equal(isOpenFiller({ filler: { day: 1 }, status: 'candidate' }), true)
  assert.equal(isOpenFiller({ filler: { day: 1, dismissed: true }, status: 'candidate' }), false)
  assert.equal(isOpenFiller({ filler: { day: 1 }, status: 'building' }), false)
  assert.equal(isOpenFiller({ status: 'candidate' }), false)
})

const { buildUpdate, decideBuildRequest } = require('../functions/lib/features/request-build/logic.js')

test('空きへの提案を入れる：建てた人のやりたいことになり、無視した提案は建てない（features/request-build）', () => {
  assert.deepEqual(buildUpdate({ filler: { day: 2 } }, 'me'), { status: 'building', builtBy: 'me', buildStartedAt: null, uid: 'me' })
  // ふつうの候補は、希望を書いた人のまま
  assert.deepEqual(buildUpdate({}, 'me'), { status: 'building', builtBy: 'me', buildStartedAt: null })
  const facts = { isMember: true, pinStatus: 'candidate', builtCount: 0 }
  assert.equal(decideBuildRequest(facts), 'ok')
  assert.equal(decideBuildRequest({ ...facts, dismissed: true }), 'not-found')
})

test('帰る場所：出発地と違う場所を選んだ旅は、最後の帰りの移動をそこまでで見る。ないときは出発地へ帰る（Takana の依頼、2026-11-22）', () => {
  const { tripOrigin } = require('../functions/lib/domain/tripOrigin.js')
  const home = buildPlan([CASTLE, SOBA], ORIGIN, 1, STYLE_TIMINGS.shortest)
  // 長野駅は松本駅より遠いので、帰りの移動が長くなる
  const farther = buildPlan([CASTLE, SOBA], { ...ORIGIN, returnLocation: { lat: 36.6431, lng: 138.1887 } }, 1, STYLE_TIMINGS.shortest)
  assert.ok(farther.schedule.at(-1).returnMinutes > home.schedule.at(-1).returnMinutes)
  // 旅から：帰る場所があれば位置を渡し、出発地と同じ・ないときは渡さない
  const point = { name: '長野駅', location: { lat: 36.6431, lng: 138.1887 }, placeId: null }
  assert.deepEqual(tripOrigin({ origin: '松本駅', returnTo: '長野駅', returnPoint: point }).returnLocation, point.location)
  assert.equal(tripOrigin({ origin: '松本駅' }).returnLocation, undefined)
  assert.equal(tripOrigin({ origin: '松本駅', returnTo: '松本駅' }).returnLocation, undefined)
})
