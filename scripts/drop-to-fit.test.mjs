// しおりが時間に収まらないときに外す場所を決める処理（functions/src/domain/dropToFit.ts と、propose-routes の logic.ts・prompt.ts の rankPlacesTask。#622）を、
// Emulator なしで確かめる。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const fit = require('../functions/lib/domain/dropToFit.js')
const { STYLE_TIMINGS, proposeOrders } = require('../functions/lib/domain/routePlan.js')
const { parseRanking, rankInput, rankPlacesTask } = { ...require('../functions/lib/features/propose-routes/logic.js'), ...require('../functions/lib/features/propose-routes/prompt.js') }

const OSAKA = { name: '大阪駅', location: { lat: 34.702, lng: 135.495 } }
const at = (id, lat, lng, category, uid = 'u1', extra = {}) => ({ id, name: id, location: { lat, lng }, uid, category, ...extra })
const KIYOMIZU = at('kiyomizu', 34.995, 135.785, 'shrine', 'u1')
const NISHIKI = at('nishiki', 35.005, 135.765, 'food', 'u2')
const KINKAKU = at('kinkaku', 35.039, 135.729, 'shrine', 'u3')
const USJ = at('usj', 34.666, 135.432, 'themepark', 'u2')
const KABIRA = at('kabira', 24.457, 124.146, 'nature', 'u3')
const TAKETOMI = at('taketomi', 24.326, 124.088, 'nature', 'u3')
const timing = STYLE_TIMINGS.shortest
const tripOf = (places, days, origin = OSAKA) => {
  const order = proposeOrders(places, origin).shortest
  return { order, measure: fit.measureTrip(origin, days, timing) }
}

test('時間に収まる旅では、1 つも外さない', () => {
  const { order, measure } = tripOf([KIYOMIZU, NISHIKI, KINKAKU], 1)
  assert.ok(measure(order).over <= fit.OVER_ALLOWANCE_MINUTES)
  const result = fit.dropToFit(order, OSAKA, measure)
  assert.deepEqual(result.leftOut, [])
  assert.equal(result.order.length, 3)
  assert.equal(result.rankedBy, 'none')
})

test('収まらない旅では、外したあとの越えが許す幅に収まる。遠い塊（2 つ）はまとめて外れ、近くの場所は残る', () => {
  // 大阪から京都の日帰りに、USJ（終日）と石垣島の 2 つ。日帰りなら、石垣島の 2 つはまとめて外さないと収まらない
  const { order, measure } = tripOf([KIYOMIZU, NISHIKI, KINKAKU, USJ, KABIRA, TAKETOMI], 1)
  assert.ok(measure(order).over > fit.OVER_ALLOWANCE_MINUTES)
  const result = fit.dropToFit(order, OSAKA, measure)
  assert.ok(measure(result.order).over <= fit.OVER_ALLOWANCE_MINUTES)
  assert.ok(result.leftOut.includes('kabira') && result.leftOut.includes('taketomi'), `石垣島の 2 つが外れる：${result.leftOut}`)
  for (const id of ['kiyomizu', 'nishiki', 'kinkaku']) assert.ok(!result.leftOut.includes(id), `${id} は残る`)
  assert.equal(result.rankedBy, 'own')
  // 残った順番は、もとの順番のまま
  const kept = order.map((place) => place.id).filter((id) => !result.leftOut.includes(id))
  assert.deepEqual(result.order.map((place) => place.id), kept)
})

test('近い場所の塊：片道 2 時間以内でつながる場所は同じ塊。遠い塊の片道（reach）は、近い塊よりずっと長い', () => {
  const { order } = tripOf([KIYOMIZU, NISHIKI, KABIRA, TAKETOMI], 2)
  const groups = fit.placeGroups(order, OSAKA)
  assert.equal(groups.get('kiyomizu'), groups.get('nishiki'))
  assert.equal(groups.get('kabira'), groups.get('taketomi'))
  assert.notEqual(groups.get('kiyomizu'), groups.get('kabira'))
  const reach = fit.groupReach(order, OSAKA, groups)
  assert.ok(reach.get(groups.get('kabira')) > 120)
})

// 越えを、残っている場所から決める見本の物差し。a・b・c はどれも 1 つ 60 分、far は 1 つで 180 分越える
const fake = (base) => (order) => {
  const ids = new Set(order.map((place) => place.id))
  let over = base
  for (const id of ['a', 'b', 'c']) if (ids.has(id)) over += 60
  if (ids.has('far')) over += 180
  return { over, move: ids.has('far') ? 300 : 60 }
}
const NEAR = (id, uid = 'u1') => at(id, 34.7, 135.5, 'town', uid)
const FAR = at('far', 24.4, 124.1, 'nature', 'u2')

test('渡された残したい順を使い、低いほうから外す。外しすぎた場所は、順の高いほうから戻す', () => {
  const order = [NEAR('a'), NEAR('b'), NEAR('c'), FAR]
  // 越えは 360 分。順の最後の c、b、far を外すと 300 → 240 → 60。収まったので a は残る
  const result = fit.dropToFit(order, OSAKA, fake(0), ['a', 'far', 'b', 'c'])
  assert.equal(result.rankedBy, 'given')
  assert.deepEqual(result.order.map((place) => place.id), ['a'])
  assert.deepEqual([...result.leftOut].sort(), ['b', 'c', 'far'])
  // 順の低いほうから外しても収まらない（far を最後まで残すと、1 つ残す決めで far しか残らず 180 分越える）なら、自分たちの計算を採る
  const stuck = fit.dropToFit(order, OSAKA, fake(0), ['far', 'a', 'b', 'c'])
  assert.equal(stuck.rankedBy, 'own')
  assert.ok(stuck.leftOut.includes('far'))
})

test('残したい順が形どおりでない（抜け、重なり、知らない ID、空）ときは、自分たちの計算の順に戻る', () => {
  const order = [NEAR('a'), NEAR('b'), NEAR('c'), FAR]
  for (const ranking of [['a', 'b', 'c'], ['a', 'a', 'b', 'c', 'far'], ['a', 'b', 'c', 'far', 'ghost'], [], undefined]) {
    const result = fit.dropToFit(order, OSAKA, fake(0), ranking)
    assert.equal(result.rankedBy, 'own', JSON.stringify(ranking))
    // 自分たちの計算では、収まるいちばん少ない外し方（360 → 60 分。far と、ほか 2 つの 3 つ）を探す
    assert.equal(result.leftOut.length, 3)
    assert.ok(result.leftOut.includes('far'))
  }
})

test('宿と時刻が決まったイベントは外さない。それだけで越えているときは、効かない場所まで外さない', () => {
  const inn = at('inn', 34.7, 135.5, 'lodging', 'u1', { lodging: { want: 1 } })
  const show = at('show', 34.7, 135.5, 'nightview', 'u1', { event: { kind: 'fireworks', date: '2027-07-31', start: 1140, end: 1230, leadMinutes: 60, source: '見本' } })
  const order = [NEAR('a'), inn, show, NEAR('b')]
  // 宿とイベントがあると 300 分越え、a、b はそれぞれ 60 分
  const measure = (places) => {
    const ids = new Set(places.map((place) => place.id))
    return { over: 300 + (ids.has('a') ? 60 : 0) + (ids.has('b') ? 60 : 0), move: 0 }
  }
  const result = fit.dropToFit(order, OSAKA, measure)
  assert.ok(!result.leftOut.includes('inn') && !result.leftOut.includes('show'))
  // 外せる場所は 1 つ残すので、a か b の 1 つを外して 360 分まで（それより下は目指さない）
  assert.equal(result.leftOut.length, 1)
  // 宿とイベントは、渡された順に入っていなくても使える
  assert.equal(fit.validRanking(['b', 'a'], order), true)
  // a、b がどちらも効かないなら、外さない
  const flat = () => ({ over: 300, move: 0 })
  assert.deepEqual(fit.dropToFit(order, OSAKA, flat).leftOut, [])
})

test('同じくらい効く候補なら、移動が多く減るほう、それも同じなら残っている場所の多い人の場所を外す', () => {
  // どれを 1 つ外しても越えが 0 になる。移動は far を外すと大きく減る
  const order = [NEAR('a', 'u1'), NEAR('b', 'u1'), FAR]
  const measure = (places) => ({ over: places.length === 3 ? 120 : 0, move: places.some((place) => place.id === 'far') ? 300 : 60 })
  assert.deepEqual(fit.dropToFit(order, OSAKA, measure).leftOut, ['far'])
  // 移動も同じなら、場所が 2 つ残っている u1 の場所を外す
  const even = [NEAR('a', 'u1'), NEAR('b', 'u1'), NEAR('c', 'u2')]
  const same = (places) => ({ over: places.length === 3 ? 120 : 0, move: 60 })
  const left = fit.dropToFit(even, OSAKA, same).leftOut
  assert.equal(left.length, 1)
  assert.ok(['a', 'b'].includes(left[0]))
})

test('Gemini に渡す入力：外さない場所を入れず、人は呼び名にし、いる時間・まとまり・片道をこちらで計算して渡す', () => {
  const inn = at('inn', 34.7, 135.5, 'lodging', 'u9', { lodging: { want: 1 } })
  const { order } = tripOf([KIYOMIZU, NISHIKI, KABIRA, TAKETOMI, inn], 2)
  const input = rankInput(order, OSAKA, 2, timing, '京都の旅', 300)
  assert.ok(!input.places.some((place) => place.id === 'inn'))
  assert.deepEqual([...new Set(input.places.map((place) => place.wisher))].sort(), ['人1', '人2', '人3'])
  assert.ok(!JSON.stringify(input).includes('u1'))
  const kabira = input.places.find((place) => place.id === 'kabira')
  const taketomi = input.places.find((place) => place.id === 'taketomi')
  assert.equal(kabira.group, taketomi.group)
  assert.ok(kabira.reach > 120)
  assert.equal(input.places.find((place) => place.id === 'kiyomizu').stay, 90)
  const prompt = rankPlacesTask.prompt(input)
  assert.ok(prompt.includes('残したい順') && prompt.includes('"ranking"'))
  assert.deepEqual(rankPlacesTask.stub(input), { ranking: [] })
  assert.deepEqual(parseRanking({ ranking: ['a', 'b'] }), { ranking: ['a', 'b'] })
  assert.throws(() => parseRanking({ ranking: 'a' }))
  assert.throws(() => parseRanking({ ranking: [1] }))
})

const logic = require('../functions/lib/features/propose-routes/logic.js')
const { SHIORI_ROUTE_ID } = require('../functions/lib/domain/route.js')

// 京都の日帰り（大阪から）のしおりに、建物が建つ。石垣島の 2 つが建つと、日帰りに入りきらない
const shioriOf = (places) => {
  const order = proposeOrders(places, OSAKA).shortest
  return { style: 'shortest', pinIds: order.map((place) => place.id), revision: 0, addedPinIds: [] }
}

test('建物を足すと時間に収まらないときは、しおりから外して leftOutPinIds に入れる。外した場所は、あとで足し直さない', () => {
  const route = shioriOf([KIYOMIZU, NISHIKI, KINKAKU])
  const all = [KIYOMIZU, NISHIKI, KINKAKU, KABIRA, TAKETOMI]
  // 収まらないので、Gemini に順を聞く入力が作られる（外さない場所と人の ID は入らない）
  const input = logic.rankRequest(route, all, OSAKA, 1, '京都の日帰り')
  assert.ok(input && input.overMinutes > fit.OVER_ALLOWANCE_MINUTES)
  const update = logic.addToDecidedRoute(route, all, OSAKA, 1)
  assert.deepEqual([...update.leftOutPinIds].sort(), ['kabira', 'taketomi'])
  assert.ok(!update.pinIds.includes('kabira') && !update.pinIds.includes('taketomi'))
  // 足したと知らせるのは、しおりに入った場所だけ
  assert.deepEqual(update.addedPinIds, [])
  // 次に建物が建っても、外した場所は足し直さない
  const next = logic.addToDecidedRoute({ ...route, ...update }, [...all, at('ginkaku', 35.027, 135.798, 'shrine', 'u1')], OSAKA, 1)
  assert.ok(next && !next.pinIds.includes('kabira') && next.leftOutPinIds === undefined)
})

test('建物を足しても時間に収まるなら、何も外さず、Gemini に順を聞かない。Gemini の順を渡せばその順で外す', () => {
  const route = shioriOf([KIYOMIZU])
  assert.equal(logic.rankRequest(route, [KIYOMIZU, NISHIKI], OSAKA, 1, '京都の日帰り'), null)
  const update = logic.addToDecidedRoute(route, [KIYOMIZU, NISHIKI], OSAKA, 1)
  assert.equal(update.leftOutPinIds, undefined)
  assert.deepEqual(update.addedPinIds, ['nishiki'])
  // Gemini の順：石垣島を残したい（川平、竹富を上）と言われても、外す数が自分たちの計算より 2 つ以上多くなければ、その順で外す
  const many = shioriOf([KIYOMIZU, NISHIKI, KINKAKU])
  const all = [KIYOMIZU, NISHIKI, KINKAKU, KABIRA, TAKETOMI]
  const own = logic.addToDecidedRoute(many, all, OSAKA, 1)
  // 京都の 3 か所を下げた順：自分たちの計算（石垣島の 2 つ）と違う外し方になり、Gemini の順で外したと分かる
  const kyotoLast = logic.addToDecidedRoute(many, all, OSAKA, 1, undefined, ['kabira', 'taketomi', 'kiyomizu', 'nishiki', 'kinkaku'])
  const ownOrder = [...own.leftOutPinIds].sort()
  assert.deepEqual(ownOrder, ['kabira', 'taketomi'])
  // 石垣島を残すと日帰りに収まらないので、Gemini の順は採らず、自分たちの計算と同じになる
  assert.deepEqual([...kyotoLast.leftOutPinIds].sort(), ownOrder)
  // 石垣島を下げた順なら、その順で外し、結果は自分たちの計算と同じ 2 つ
  const given = logic.addToDecidedRoute(many, all, OSAKA, 1, undefined, ['kiyomizu', 'nishiki', 'kinkaku', 'kabira', 'taketomi'])
  assert.deepEqual([...given.leftOutPinIds].sort(), ['kabira', 'taketomi'])
  assert.deepEqual(given.pinIds.filter((id) => !id.startsWith('@')).sort(), ['kinkaku', 'kiyomizu', 'nishiki'])
  // 形の違う順（抜け、知らない ID）は、自分たちの計算と同じ結果になる
  for (const bad of [['kiyomizu'], ['kiyomizu', 'nishiki', 'kinkaku', 'kabira', 'taketomi', 'ghost']]) {
    const result = logic.addToDecidedRoute(many, all, OSAKA, 1, undefined, bad)
    assert.deepEqual(result.leftOutPinIds, own.leftOutPinIds, JSON.stringify(bad))
    assert.deepEqual(result.pinIds, own.pinIds)
  }
})

test('Gemini の順で外す数が、自分たちの計算より 2 つ以上多いときは、自分たちの計算を採る', () => {
  // a〜e はどれも 60 分ずつ越える。far は 1 つで 240 分。far を外せば 1 つで収まる
  const order = ['a', 'b', 'c', 'd'].map((id) => NEAR(id)).concat([FAR])
  const measure = (places) => {
    const ids = new Set(places.map((place) => place.id))
    let over = (ids.has('far') ? 240 : 0) + ['a', 'b', 'c', 'd'].filter((id) => ids.has(id)).length * 15
    return { over, move: 0 }
  }
  // far を最上位にした順：a〜d を下から外していくと、far を残したままでは 240 分を下回れない → 収まらないので自分たちの計算
  const result = fit.dropToFit(order, OSAKA, measure, ['far', 'a', 'b', 'c', 'd'])
  assert.equal(result.rankedBy, 'own')
  assert.deepEqual(result.leftOut, ['far'])
  assert.equal(fit.EXTRA_DROPS_FOR_GIVEN, 1)
})

test('しおりを作るときも、時間に収まらなければ外す（自分たちの計算の順）', () => {
  const input = { tripTitle: '京都の日帰り', origin: OSAKA, days: 1, places: [KIYOMIZU, NISHIKI, KINKAKU, KABIRA, TAKETOMI] }
  const draft = logic.draftShiori(logic.stubOptions(input).options, input, 'stub')
  assert.equal(draft.id, SHIORI_ROUTE_ID)
  assert.deepEqual([...draft.leftOutPinIds].sort(), ['kabira', 'taketomi'])
  assert.ok(!draft.pinIds.includes('kabira'))
})
