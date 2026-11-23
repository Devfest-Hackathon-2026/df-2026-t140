// しおりの宿の枠（functions/src/domain/routePlan.ts の splitByNights・assignLodging・buildPlan、features/propose-routes、
// reorder-shiori、remove-building、set-lodging、suggest-places の宿さがし）を、Emulator なしで確かめる。
// scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { assignLodging, buildPlan, splitByNights, STYLE_TIMINGS, routeTiming } = require('../functions/lib/domain/routePlan.js')
const { LODGING_SKIP, isLodgingSkip, lodgingSkipValue, openLodgingNights } = require('../functions/lib/domain/route.js')
const { lodgingOf } = require('../functions/lib/domain/pin.js')
const { lodgingNightOf } = require('../functions/lib/domain/wish.js')
const { addToDecidedRoute, draftShiori, stubOptions } = require('../functions/lib/features/propose-routes/logic.js')
const { moveStop } = require('../functions/lib/features/reorder-shiori/logic.js')
const { routeWithVisitAdded, routeWithVisitRemoved } = require('../functions/lib/features/repeat-visit/logic.js')
const { routeAfterRemoval } = require('../functions/lib/features/remove-building/logic.js')
const { lodgingAfterSkip } = require('../functions/lib/features/set-lodging/logic.js')
const suggest = require('../functions/lib/features/suggest-places/logic/index.js')
const { suggestPlacesTask } = require('../functions/lib/features/suggest-places/prompt.js')
const { prefabFor } = require('../functions/lib/features/build-model/logic/prefabs.js')

// 長野の 4 か所と、宿 2 つ。松本駅から車で回る
const ORIGIN = { name: '松本駅', location: { lat: 36.2308, lng: 137.9644 }, travelMode: 'car' }
const WASABI = { id: 'wasabi', name: '大王わさび農場', location: { lat: 36.337, lng: 137.91 }, uid: 'u1' }
const CASTLE = { id: 'castle', name: '松本城', location: { lat: 36.2386, lng: 137.9689 }, uid: 'u2' }
const ZENKOJI = { id: 'zenkoji', name: '善光寺', location: { lat: 36.6617, lng: 138.1876 }, uid: 'u1' }
const TOGAKUSHI = { id: 'togakushi', name: '戸隠神社', location: { lat: 36.743, lng: 138.085 }, uid: 'u3' }
const INN_MATSUMOTO = { id: 'inn-m', name: '松本駅周辺の宿', location: { lat: 36.23, lng: 137.97 }, uid: 'u2', lodging: { want: null } }
const INN_NAGANO = { id: 'inn-n', name: '長野駅周辺の宿', location: { lat: 36.64, lng: 138.19 }, uid: 'u3', lodging: { want: null } }
const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const ids = (places) => places.map((place) => place.id)

test('宿の枠：宿がなければ、今までどおり場所の数で日に分ける', () => {
  const order = [WASABI, CASTLE, ZENKOJI]
  const { groups, used } = splitByNights(order, 2)
  assert.deepEqual(groups.map((group) => [group.day, ids(group.places)]), [[1, ['wasabi', 'castle']], [2, ['zenkoji']]])
  assert.deepEqual(used, {})
  // 宿を取らない夜は、日の分け方を変えない
  const skipped = splitByNights(order, 2, { 1: LODGING_SKIP })
  assert.deepEqual(skipped.groups, groups)
  assert.deepEqual(skipped.used, { 1: LODGING_SKIP })
})

test('宿の枠：宿が決まっている夜は、宿がその日の最後になり、次の場所から翌日になる', () => {
  const order = [WASABI, INN_MATSUMOTO, CASTLE, ZENKOJI, TOGAKUSHI]
  const { groups, used } = splitByNights(order, 2, { 1: 'inn-m' })
  assert.deepEqual(groups.map((group) => [group.day, ids(group.places)]), [[1, ['wasabi', 'inn-m']], [2, ['castle', 'zenkoji', 'togakushi']]])
  assert.deepEqual(used, { 1: 'inn-m' })
  // 2 泊 3 日で 2 日目の夜だけ決まっている：宿までの場所を 2 日に分け、宿は 2 日目の最後
  const three = splitByNights([WASABI, CASTLE, ZENKOJI, INN_NAGANO, TOGAKUSHI], 3, { 2: 'inn-n' })
  assert.deepEqual(three.groups.map((group) => [group.day, ids(group.places)]), [[1, ['wasabi', 'castle']], [2, ['zenkoji', 'inn-n']], [3, ['togakushi']]])
  // 宿より前の場所が日数より少ないと、宿だけの日ができる
  const sparse = splitByNights([WASABI, INN_NAGANO], 3, { 2: 'inn-n' })
  assert.deepEqual(sparse.groups.map((group) => [group.day, ids(group.places)]), [[1, ['wasabi']], [2, ['inn-n']]])
})

test('宿の枠：しおりにない宿、日程より先の夜、回る順と食い違う宿は、宿として扱わず、保存する形からも外す', () => {
  const order = [WASABI, INN_MATSUMOTO, CASTLE]
  // 消えた宿
  assert.deepEqual(splitByNights([WASABI, CASTLE], 2, { 1: 'inn-m' }).used, {})
  // 日帰りにした旅（泊まる夜がない）
  const dayTrip = splitByNights(order, 1, { 1: 'inn-m' })
  assert.deepEqual(dayTrip.used, {})
  assert.deepEqual(dayTrip.groups.map((group) => ids(group.places)), [['wasabi', 'inn-m', 'castle']])
  // 2 日目の夜の宿が、1 日目の夜の宿より前にある
  const crossed = splitByNights([INN_NAGANO, WASABI, INN_MATSUMOTO, CASTLE], 3, { 1: 'inn-m', 2: 'inn-n' })
  assert.deepEqual(crossed.used, { 1: 'inn-m' })
})

test('宿の枠：宿の行は翌朝までいて、翌日は宿を出る時刻に移動を足した時刻から始まる', () => {
  const order = [WASABI, INN_MATSUMOTO, ZENKOJI]
  const plan = buildPlan(order, ORIGIN, 2, { ...STYLE_TIMINGS.shortest, lodging: { 1: 'inn-m' } })
  const [origin, wasabi, inn, zenkoji] = plan.schedule
  assert.equal(origin.pinId, null)
  assert.deepEqual([wasabi.day, inn.day, zenkoji.day], [1, 1, 2])
  // 宿に着くのは、前の場所の滞在と移動のあと
  assert.equal(minutesOf(inn.time), minutesOf(wasabi.time) + wasabi.stayMinutes + wasabi.moveMinutesToNext)
  // 宿を出るのは翌朝 9 時（着いた時刻 ＋ いる時間が、24 時間 ＋ 9 時間）
  assert.equal(minutesOf(inn.time) + inn.stayMinutes, 24 * 60 + 9 * 60)
  // 翌日の 1 つ目の場所には、9 時 ＋ 宿からの移動で着く
  assert.equal(minutesOf(zenkoji.time), 9 * 60 + inn.moveMinutesToNext)
  assert.deepEqual(plan.lodging, { 1: 'inn-m' })
  // 着くのが 24 時を過ぎても、宿を出るのは翌朝 9 時（いる時間は、着いてから 9 時まで）
  const late = buildPlan(order, ORIGIN, 2, { startMinutes: 23 * 60, stayMinutes: 60, lodging: { 1: 'inn-m' } })
  const lateInn = late.schedule.find((stop) => stop.pinId === 'inn-m')
  const arrived = 23 * 60 + late.schedule[0].moveMinutesToNext + 60 + late.schedule[1].moveMinutesToNext
  assert.ok(arrived >= 24 * 60)
  assert.equal(lateInn.stayMinutes, 23 * 60 - (arrived - 24 * 60))
  // 宿がなければ、19 時までに入る場所は同じ日にまとめる（#520）。lodging も返さない
  const plain = buildPlan([WASABI, ZENKOJI], ORIGIN, 2, STYLE_TIMINGS.shortest)
  assert.deepEqual(plain.schedule.filter((stop) => stop.pinId).map((stop) => stop.day), [1, 1])
  assert.equal('lodging' in plain, false)
  // 宿のない夜で次の日に分かれても、翌日は 9 時に前の日の最後の場所を出て、移動のあとに着く（#602）
  const split = buildPlan([WASABI, ZENKOJI], ORIGIN, 2, { startMinutes: 9 * 60, stayMinutes: 60 })
  assert.equal(split.schedule.at(-1).day, 2)
  assert.equal(minutesOf(split.schedule.at(-1).time), 9 * 60 + split.schedule.at(-2).moveMinutesToNext)
})

test('宿の枠：建った宿は、押した夜が空いていればその夜、なければ最後の場所がいちばん近い空いた夜に入る', () => {
  // 2 泊 3 日。1 日目は松本、2 日目は長野、3 日目は戸隠
  const order = [WASABI, CASTLE, ZENKOJI, TOGAKUSHI]
  // 長野の宿を、夜を決めずに建てた：2 日目（最後が善光寺）の夜がいちばん近い
  const near = assignLodging(order, INN_NAGANO, 3)
  assert.equal(near.night, 2)
  assert.deepEqual(ids(near.order), ['wasabi', 'castle', 'zenkoji', 'inn-n', 'togakushi'])
  assert.deepEqual(near.lodging, { 2: 'inn-n' })
  // 1 日目の夜の枠から探して建てた：遠くても 1 日目の夜
  const wanted = assignLodging(order, INN_NAGANO, 3, {}, 1)
  assert.equal(wanted.night, 1)
  assert.deepEqual(ids(wanted.order), ['wasabi', 'castle', 'inn-n', 'zenkoji', 'togakushi'])
  // 押した夜がもう埋まっている：空いている夜へ
  const taken = assignLodging(near.order, INN_MATSUMOTO, 3, near.lodging, 2)
  assert.equal(taken.night, 1)
  assert.deepEqual(taken.lodging, { 1: 'inn-m', 2: 'inn-n' })
  // 宿を取らないと決めた夜も、宿が建てば宿にする
  assert.equal(assignLodging(order, INN_NAGANO, 2, { 1: LODGING_SKIP }).lodging[1], 'inn-n')
  // 空いている夜がない（日帰り、全部決まっている）
  assert.equal(assignLodging(order, INN_NAGANO, 1), null)
  assert.equal(assignLodging(taken.order, { ...INN_NAGANO, id: 'inn-x' }, 3, taken.lodging), null)
  // 場所がまだない夜は、それより前の最後の場所のあとに入る
  const early = assignLodging([WASABI], INN_NAGANO, 3, {}, 2)
  assert.deepEqual(ids(early.order), ['wasabi', 'inn-n'])
  assert.deepEqual(splitByNights(early.order, 3, early.lodging).groups.map((group) => group.day), [1, 2])
})

test('宿の枠：建った宿を、しおりの泊まる夜に足す（ふつうの場所は今までどおり）', () => {
  const route = { style: 'shortest', pinIds: ['wasabi', 'zenkoji'], revision: 0, addedPinIds: [] }
  const withInn = addToDecidedRoute(route, [WASABI, ZENKOJI, { ...INN_MATSUMOTO, lodging: { want: 1 } }], ORIGIN, 2)
  // わさび農場と善光寺は 1 日目の 19 時までに回れるので、宿は 1 日目の最後（善光寺のあと）に入る（#520 の時間での日の分け方）
  assert.deepEqual(withInn.pinIds, ['wasabi', 'zenkoji', 'inn-m'])
  assert.deepEqual(withInn.lodging, { 1: 'inn-m' })
  assert.deepEqual(withInn.schedule.filter((stop) => stop.pinId).map((stop) => stop.day), [1, 1, 1])
  // 日帰りの旅では、宿もふつうの場所として並ぶ（lodging は書かない）
  const dayTrip = addToDecidedRoute(route, [WASABI, ZENKOJI, INN_MATSUMOTO], ORIGIN, 1)
  assert.equal(dayTrip.pinIds.length, 3)
  assert.equal('lodging' in dayTrip, false)
  // 宿の入ったしおりに場所を足しても、宿はその日の最後のまま
  const more = addToDecidedRoute({ ...route, ...withInn }, [WASABI, ZENKOJI, INN_MATSUMOTO, CASTLE], ORIGIN, 2)
  const day1 = more.schedule.filter((stop) => stop.day === 1 && stop.pinId).map((stop) => stop.pinId)
  assert.equal(day1.at(-1), 'inn-m')
  assert.deepEqual(more.lodging, { 1: 'inn-m' })
})

test('宿の枠：最初に建ったのが宿でも、しおりを作るときに泊まる夜へ入れる', () => {
  const input = {
    tripTitle: '信州の旅',
    origin: ORIGIN,
    days: 2,
    places: [{ ...INN_MATSUMOTO, category: 'lodging' }, { ...WASABI, category: 'farm' }, { ...ZENKOJI, category: 'shrine' }],
  }
  const draft = draftShiori(stubOptions(input).options, input, 'stub')
  assert.deepEqual(draft.lodging, { 1: 'inn-m' })
  const day1 = draft.schedule.filter((stop) => stop.day === 1 && stop.pinId).map((stop) => stop.pinId)
  assert.equal(day1.at(-1), 'inn-m')
  assert.equal(draft.pinIds.length, 3)
  // 宿のない旅のしおりには、lodging を書かない
  const plain = { ...input, places: input.places.slice(1) }
  assert.equal('lodging' in draftShiori(stubOptions(plain).options, plain, 'stub'), false)
})

test('宿の枠：宿の行は取って動かせず、ほかの行を動かしても宿はその日の最後に残る', () => {
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle', 'zenkoji'], revision: 1, lodging: { 1: 'inn-m' } }
  const places = [WASABI, INN_MATSUMOTO, CASTLE, ZENKOJI]
  const days = (update) => update.schedule.filter((stop) => stop.pinId).map((stop) => stop.day)
  assert.equal(moveStop(route, places, ORIGIN, 2, 'inn-m', 'castle'), null)
  // 下から宿の行に落とすと、宿のすぐ上（その日の最後の場所）に入る
  const up = moveStop(route, places, ORIGIN, 2, 'castle', 'inn-m')
  assert.deepEqual(up.pinIds, ['wasabi', 'castle', 'inn-m', 'zenkoji'])
  assert.deepEqual(up.lodging, { 1: 'inn-m' })
  assert.deepEqual(days(up), [1, 1, 1, 2])
  // 上から宿の行に落とすと、宿のすぐ下（翌日の最初）に入る
  const down = moveStop({ ...route, pinIds: up.pinIds }, places, ORIGIN, 2, 'wasabi', 'inn-m')
  assert.deepEqual(down.pinIds, ['castle', 'inn-m', 'wasabi', 'zenkoji'])
  assert.deepEqual(days(down), [1, 1, 2, 2])
  const moved = moveStop(route, places, ORIGIN, 2, 'wasabi', 'zenkoji')
  assert.deepEqual(moved.pinIds, ['inn-m', 'castle', 'zenkoji', 'wasabi'])
  assert.deepEqual(moved.lodging, { 1: 'inn-m' })
  assert.deepEqual(days(moved), [1, 2, 2, 2])
})

test('宿の枠：宿の行を複製しても足した行は宿にならず、宿の行を消すとその夜は空きに戻る（同じ場所を何度も訪れるしおり）', () => {
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle'], revision: 1, lodging: { 1: 'inn-m', 2: LODGING_SKIP } }
  const places = [WASABI, INN_MATSUMOTO, CASTLE]
  const added = routeWithVisitAdded(route, places, ORIGIN, 3, 'inn-m')
  assert.deepEqual(added.pinIds, ['wasabi', 'inn-m', 'inn-m~2', 'castle'])
  assert.deepEqual(added.lodging, { 1: 'inn-m', 2: LODGING_SKIP })
  // 足した行は翌日の最初の行で、宿泊の長さにならない。松本城は同じ日の 19 時までに回れるので 2 日目に入る（#520）
  const rows = added.schedule.filter((stop) => stop.pinId)
  assert.deepEqual(rows.map((stop) => [stop.stopId ?? stop.pinId, stop.day]), [['wasabi', 1], ['inn-m', 1], ['inn-m~2', 2], ['castle', 2]])
  assert.ok(rows[1].stayMinutes > rows[2].stayMinutes)
  // ほかの場所の行を複製しても、宿はそのまま
  assert.deepEqual(routeWithVisitAdded(route, places, ORIGIN, 3, 'wasabi').lodging, { 1: 'inn-m', 2: LODGING_SKIP })
  // 複製した行を消しても宿は残り、宿の行を消すとその夜の宿が外れる（残った行は、ふつうの行）
  const copied = { ...route, pinIds: added.pinIds, lodging: added.lodging }
  assert.deepEqual(routeWithVisitRemoved(copied, places, ORIGIN, 3, 'inn-m~2').lodging, { 1: 'inn-m', 2: LODGING_SKIP })
  const removed = routeWithVisitRemoved(copied, places, ORIGIN, 3, 'inn-m')
  assert.deepEqual(removed.pinIds, ['wasabi', 'inn-m', 'castle'])
  assert.deepEqual(removed.lodging, { 2: LODGING_SKIP })
})

test('宿の枠：宿の建物を消すと、その夜の枠は空きに戻る（宿を取らない夜は残る）', () => {
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle', 'zenkoji'], revision: 1, addedPinIds: [], lodging: { 1: 'inn-m', 2: LODGING_SKIP } }
  const next = routeAfterRemoval(route, [WASABI, CASTLE, ZENKOJI], ORIGIN, 3, 'inn-m', true)
  assert.equal(next.kind, 'update')
  assert.deepEqual(next.update.pinIds, ['wasabi', 'castle', 'zenkoji'])
  assert.deepEqual(next.update.lodging, { 2: LODGING_SKIP })
  // 宿のないしおりでは、lodging を書かない
  const plain = routeAfterRemoval({ ...route, lodging: undefined, pinIds: ['wasabi', 'castle'] }, [WASABI], ORIGIN, 2, 'castle', true)
  assert.equal('lodging' in plain.update, false)
  // routeTiming は、ルートの lodging を時間の決めに入れる
  assert.deepEqual(routeTiming(route).lodging, route.lodging)
  assert.equal('lodging' in routeTiming({ style: 'shortest' }), false)
})

test('宿の枠：宿を取らない夜にする（過ごし方を自分で書ける）・取り消す', () => {
  const route = { revision: 3 }
  const skipped = lodgingAfterSkip(route, 3, 1, true)
  assert.deepEqual(skipped, { lodging: { 1: LODGING_SKIP }, revision: 4 })
  assert.deepEqual(lodgingAfterSkip({ ...route, ...skipped }, 3, 1, false), { lodging: {}, revision: 5 })
  assert.equal(lodgingAfterSkip({ ...route, ...skipped }, 3, 1, true), 'unchanged')
  assert.equal(lodgingAfterSkip(route, 3, 1, false), 'unchanged')
  // 自分で書いた過ごし方は、印のうしろに付けて残す。書き直すと変わり、同じなら変わらない
  const noted = lodgingAfterSkip(route, 3, 1, true, ' 車中泊 ')
  assert.deepEqual(noted.lodging, { 1: '@skip:車中泊' })
  assert.equal(lodgingAfterSkip({ ...route, ...noted }, 3, 1, true, '車中泊'), 'unchanged')
  assert.deepEqual(lodgingAfterSkip({ ...route, ...noted }, 3, 1, true, '夜行バス').lodging, { 1: '@skip:夜行バス' })
  assert.deepEqual(lodgingAfterSkip({ ...route, ...noted }, 3, 1, true, '').lodging, { 1: LODGING_SKIP })
  // 長すぎる過ごし方は 20 文字で切る
  assert.equal(lodgingSkipValue('あ'.repeat(30)), `@skip:${'あ'.repeat(20)}`)
  assert.ok(isLodgingSkip('@skip') && isLodgingSkip('@skip:車中泊') && !isLodgingSkip('inn-m') && !isLodgingSkip(undefined))
  // 過ごし方を書いた夜も、日の分け方を変えず、決まった夜として数え、宿が建てば宿にする
  assert.deepEqual(splitByNights([WASABI, CASTLE], 2, noted.lodging).used, { 1: '@skip:車中泊' })
  assert.deepEqual(openLodgingNights({ pinIds: [], lodging: noted.lodging }, 3), [2])
  assert.equal(assignLodging([WASABI], INN_MATSUMOTO, 2, noted.lodging).lodging[1], 'inn-m')
  // 日程にない夜（最終日の夜、日帰り）
  assert.equal(lodgingAfterSkip(route, 3, 3, true), 'invalid')
  assert.equal(lodgingAfterSkip(route, 1, 1, true), 'invalid')
  assert.equal(lodgingAfterSkip(route, 3, 1.5, true), 'invalid')
  // 宿が建物で決まっている夜は変えない
  assert.equal(lodgingAfterSkip({ revision: 1, lodging: { 1: 'inn-m' } }, 3, 1, true), 'decided')
})

test('宿の枠：宿も、宿を取らないことも決めていない夜を数える（残っていると旅程を確定できない）', () => {
  const route = { pinIds: ['wasabi', 'inn-m', 'castle'], lodging: { 1: 'inn-m', 2: LODGING_SKIP } }
  assert.deepEqual(openLodgingNights(route, 4), [3])
  assert.deepEqual(openLodgingNights(route, 3), [])
  // 日帰りの旅に泊まる夜はない。宿の項目のないしおりは、どの夜も決まっていない
  assert.deepEqual(openLodgingNights({ pinIds: [] }, 1), [])
  assert.deepEqual(openLodgingNights({ pinIds: ['wasabi'] }, 3), [1, 2])
  // 宿のピンが回る順番にない（消えた）夜は、決まっていない
  assert.deepEqual(openLodgingNights({ pinIds: ['wasabi'], lodging: { 1: 'inn-m' } }, 2), [1])
})

test('宿さがし：宿の言葉を見分け、地名の「宿」は宿さがしにしない', () => {
  for (const text of ['いい宿に泊まりたい', '駅前のホテル', '松本の旅館', '1 日目の宿', '宿を探す', '民宿に行きたい', '温泉宿', 'グランピングしたい', 'Airbnb で探す']) {
    assert.equal(suggest.wantsLodging(text), true, text)
  }
  for (const text of ['新宿で買い物', '原宿でクレープ', '奈良井宿を歩きたい', '宿場町を歩く', '温泉に入りたい', '指宿の砂むし温泉', '1泊で温泉', '御宿の海で泳ぎたい', 'サークルの合宿っぽいことをしたい', '三島宿を歩きたい']) {
    assert.equal(suggest.wantsLodging(text), false, text)
  }
})

test('宿さがし：固定の応答は、宿の名前を出さず、範囲に近いエリアを宿の種類で出す', () => {
  // 善光寺のまわり（「宿を探す」が書く範囲）
  const bounds = { north: 36.8, south: 36.52, east: 138.36, west: 138.02 }
  const places = suggestPlacesTask.stub({ text: '1 日目の夜の宿', bounds, exclude: [], prefectures: null, lodging: true }).places
  assert.equal(places.length, 3)
  assert.equal(places[0].name, '長野駅周辺の宿')
  assert.ok(places.every((place) => place.category === 'lodging' && place.name.endsWith('の宿')))
  // 文にエリアの名前があれば、そのエリアを先頭に
  assert.equal(suggest.searchLodgings({ text: '草津のいい宿', bounds, exclude: [], prefectures: null }).at(0).name, '草津温泉の宿')
  // もう出した候補と、旅の県の外は出さない
  const again = suggest.searchLodgings({ text: '宿', bounds, exclude: ['長野駅周辺の宿'], prefectures: ['長野県'] })
  assert.ok(again.every((place) => place.name !== '長野駅周辺の宿' && place.area.startsWith('長野県')))
  // 宿さがしでなければ、今までどおり見本の場所の一覧から
  const usual = suggestPlacesTask.stub({ text: '温泉に入りたい', bounds, exclude: [], prefectures: null }).places
  assert.ok(usual.every((place) => place.category === 'onsen'))
  // 宿さがしのプロンプトは、宿だけを頼み、模型の一覧は渡さない
  const prompt = suggestPlacesTask.prompt({ text: '松本のホテル', bounds, exclude: [], prefectures: null, lodging: true })
  assert.match(prompt, /lodging にしてください/)
  assert.doesNotMatch(prompt, /草津温泉｜/)
  assert.match(suggestPlacesTask.prompt({ text: '温泉', bounds, exclude: [], prefectures: null }), /草津温泉｜/)
})

test('宿さがし：泊まる所の多いエリアの一覧は、決めた形で、位置が日本の中にある', () => {
  const { LODGING_AREAS } = require('../functions/lib/features/suggest-places/logic/lodgings.js')
  assert.ok(LODGING_AREAS.length >= 60)
  assert.equal(new Set(LODGING_AREAS.map((entry) => entry.name)).size, LODGING_AREAS.length, '同じ名前が 2 つある')
  for (const entry of LODGING_AREAS) {
    assert.ok(entry.name.endsWith('の宿') && entry.name.length <= 40, entry.name)
    assert.ok(entry.description.length > 0 && entry.description.length <= 40, `${entry.name} の説明が長い`)
    assert.match(entry.pref, /^(北海道|.+[都府県])$/, entry.name)
    assert.ok(entry.lat > 24 && entry.lat < 46 && entry.lng > 123 && entry.lng < 146, entry.name)
  }
  // どの都道府県にも 1 つはある（旅の県を絞っても、候補が出る）
  assert.equal(new Set(LODGING_AREAS.map((entry) => entry.pref)).size, 47)
})

test('宿さがし：ピンと希望の「何日目の夜か」を読む。宿の部品の模型がある', () => {
  assert.deepEqual(lodgingOf({ category: 'lodging', lodgingNight: 2 }), { lodging: { want: 2 } })
  assert.deepEqual(lodgingOf({ category: 'lodging' }), { lodging: { want: null } })
  assert.deepEqual(lodgingOf({ category: 'onsen', lodgingNight: 2 }), {})
  assert.equal(lodgingNightOf({ lodgingNight: 1 }), 1)
  for (const lodgingNight of [0, 31, 1.5, '1', undefined]) assert.equal(lodgingNightOf({ lodgingNight }), null)
  assert.ok(prefabFor('lodging').parts.length > 5)
  assert.notDeepEqual(prefabFor('lodging'), prefabFor('town'))
})

// ---- 前の夜と同じ宿にする（同じ宿に 2 泊以上する。Takana の依頼、2026-11-22） ----
const { routeWithSameLodging } = require('../functions/lib/features/set-lodging/logic.js')

test('宿の枠：前の夜と同じ宿にすると、宿の行を複製してその夜の宿にし、翌日はそこから始まる', () => {
  const places = [WASABI, INN_MATSUMOTO, CASTLE, ZENKOJI, TOGAKUSHI]
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle', 'zenkoji', 'togakushi'], lodging: { 1: 'inn-m' }, revision: 3 }
  const update = routeWithSameLodging(route, places, ORIGIN, 3, 2)
  assert.equal(typeof update, 'object')
  const copy = update.lodging['2']
  assert.match(copy, /^inn-m~\d+$/)
  assert.equal(update.lodging['1'], 'inn-m')
  assert.equal(update.revision, 4)
  assert.ok(update.pinIds.includes(copy))
  // 複製した宿の行は 2 日目の最後の行で、3 日目の行はそのあと
  const rows = update.schedule.filter((stop) => stop.pinId !== null)
  const at = rows.findIndex((stop) => stop.stopId === copy)
  assert.ok(at > 0)
  assert.equal(rows[at].day, 2)
  assert.equal(rows[at].pinId, 'inn-m')
  assert.ok(rows.slice(0, at).every((stop) => stop.day <= 2))
  assert.ok(rows.slice(at + 1).every((stop) => stop.day === 3))
  // 宿を取らないと決めた夜も、同じ宿で上書きできる
  const skipped = routeWithSameLodging({ ...route, lodging: { 1: 'inn-m', 2: `${LODGING_SKIP}:車中泊` } }, places, ORIGIN, 3, 2)
  assert.match(skipped.lodging['2'], /^inn-m~\d+$/)
})

test('宿の枠：前の夜と同じ宿にできないときは、理由を返す', () => {
  const places = [WASABI, INN_MATSUMOTO, CASTLE, ZENKOJI, INN_NAGANO, TOGAKUSHI]
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle', 'zenkoji', 'inn-n', 'togakushi'], lodging: { 1: 'inn-m', 2: 'inn-n' }, revision: 0 }
  // 1 日目の夜には前の夜がない。日程の外の夜
  assert.equal(routeWithSameLodging(route, places, ORIGIN, 3, 1), 'invalid')
  assert.equal(routeWithSameLodging(route, places, ORIGIN, 3, 3), 'invalid')
  // 宿がもう建物で決まっている夜
  assert.equal(routeWithSameLodging(route, places, ORIGIN, 3, 2), 'decided')
  // 前の夜の宿が決まっていない、宿を取らない
  assert.equal(routeWithSameLodging({ ...route, lodging: {} }, places, ORIGIN, 3, 2), 'no-previous')
  assert.equal(routeWithSameLodging({ ...route, lodging: { 1: LODGING_SKIP } }, places, ORIGIN, 3, 2), 'no-previous')
  // 前の夜の宿の行が、今のしおりにない（建物が消えた）
  assert.equal(routeWithSameLodging({ ...route, lodging: { 1: 'gone' } }, places, ORIGIN, 3, 2), 'stale')
  // しおりの行が上限（40）に届いている
  const many = Array.from({ length: 39 }, (_, index) => ({ id: `s${index}`, name: `場所${index}`, location: { lat: 36.2 + index * 0.001, lng: 137.9 }, uid: 'u1' }))
  const full = { style: 'shortest', pinIds: ['inn-m', ...many.map((item) => item.id)], lodging: { 1: 'inn-m' }, revision: 0 }
  assert.equal(routeWithSameLodging(full, [INN_MATSUMOTO, ...many], ORIGIN, 3, 2), 'full')
})

test('宿の枠：3 泊目も、前の夜（複製した宿の行）と同じ宿にできる', () => {
  const places = [WASABI, INN_MATSUMOTO, CASTLE, ZENKOJI, TOGAKUSHI]
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle', 'zenkoji', 'togakushi'], lodging: { 1: 'inn-m' }, revision: 0 }
  const second = routeWithSameLodging(route, places, ORIGIN, 4, 2)
  const third = routeWithSameLodging({ ...route, ...second }, places, ORIGIN, 4, 3)
  assert.equal(typeof third, 'object')
  assert.match(third.lodging['3'], /^inn-m~\d+$/)
  assert.notEqual(third.lodging['3'], third.lodging['2'])
  assert.equal(third.lodging['1'], 'inn-m')
})

test('宿の枠：同じ宿に 2 泊したしおりで 1 泊目の宿の行を消すと、1 泊目は空き、2 泊目の宿は残る（#642 のレビュー）', () => {
  const places = [WASABI, INN_MATSUMOTO, CASTLE, ZENKOJI, TOGAKUSHI]
  const route = { style: 'shortest', pinIds: ['wasabi', 'inn-m', 'castle', 'zenkoji', 'togakushi'], lodging: { 1: 'inn-m' }, revision: 0 }
  const two = { ...route, ...routeWithSameLodging(route, places, ORIGIN, 3, 2) }
  const removed = routeWithVisitRemoved(two, places, ORIGIN, 3, 'inn-m')
  assert.equal(typeof removed, 'object')
  // 2 泊目の宿の行は、ピンの ID の行に付け替わり、2 泊目の宿のまま
  assert.equal(removed.lodging['2'], 'inn-m')
  assert.equal(removed.lodging['1'], undefined)
  assert.ok(removed.pinIds.includes('inn-m'))
  assert.ok(removed.schedule.some((stop) => stop.pinId === 'inn-m' && stop.day === 2))
})

// ---- 宿さがしを、その日の終わりに無理なく着ける場所に絞る（#629。Takana の決定 todo/humans/2026-11-22-lodging-search-realistic.md） ----
const plan = require('../functions/lib/features/suggest-places/logic/lodgingPlan.js')
const { parseFoundLodging } = require('../functions/lib/adapters/places-api.js')
const { settleLodgings } = require('../functions/lib/features/suggest-places/usecase.js')

const TOWER = { name: '東京タワー', location: { lat: 35.6586, lng: 139.7454 } }
const CLOCK = { name: '札幌市時計台', location: { lat: 43.0626, lng: 141.3536 } }
const PLACES = { tower: TOWER, clock: CLOCK, castle: { name: '松本城', location: CASTLE.location }, wasabi: { name: '大王わさび農場', location: WASABI.location } }
const stopOf = (pinId) => PLACES[pinId] ?? null
const row = (day, time, pinId, stayMinutes) => ({ day, time, pinId, name: PLACES[pinId].name, stayMinutes, moveMinutesToNext: 0 })
/** 東京タワーを出る時刻（HH:MM）を変えた、東京 → 札幌（飛行機）の 1 泊目 */
const tokyoToSapporo = (leave) => {
  const [h, m] = leave.split(':').map(Number)
  return { schedule: [row(1, '10:00', 'tower', h * 60 + m - 600), row(2, '10:00', 'clock', 60)], lodging: {} }
}
const centerOf = (bounds) => ({ lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 })
const near = (point, lat, lng) => Math.abs(point.lat - lat) < 0.2 && Math.abs(point.lng - lng) < 0.2

test('宿さがし：飛行機で移る夜は移動の途中に泊まらず、出る時刻が遅ければ出発の側、早ければ行き先の側で探す', () => {
  // 20:00 に出ると、飛行機（約 5 時間の目安）で札幌に着くのは 21:00 より後。東京の側に泊まる
  const late = plan.lodgingContext(tokyoToSapporo('20:00'), 1, stopOf, 'car')
  assert.equal(late.side, 'stay')
  assert.equal(late.move.mode, 'plane')
  assert.ok(near(centerOf(late.bounds), 35.66, 139.75), '東京の側で探していない')
  // 12:00 に出れば、夜のうちに札幌に着ける。札幌の側に泊まる
  const early = plan.lodgingContext(tokyoToSapporo('12:00'), 1, stopOf, 'car')
  assert.equal(early.side, 'move')
  assert.ok(near(centerOf(early.bounds), 43.06, 141.35), '札幌の側で探していない')
  // 残してある便（翌朝に出る前提で選んだもの）は、夜の判断に使わない（候補をふるう数え方とそろえる。#631 のレビュー）
  const saved = { ...tokyoToSapporo('12:00'), legFlights: { 'tower>clock': { minutes: 600, flight: null, fetchedAt: null } } }
  assert.equal(plan.lodgingContext(saved, 1, stopOf, 'car').side, 'move')
})

test('宿さがし：区間で飛行機を選んだ夜に行き先の側に泊まると決めたら、行き先の近くの宿が候補に残る（#631 のレビュー）', () => {
  // 車の旅で、東京タワー → 大阪（約 400 km）に飛行機を選び、16:00 に出る。飛行機の目安で 21:00 までに大阪に着くので、大阪の側
  PLACES.osaka = { name: '大阪城', location: { lat: 34.6873, lng: 135.5262 } }
  const route = { schedule: [row(1, '10:00', 'tower', 360), row(2, '10:00', 'osaka', 60)], lodging: {}, legModes: { 'tower>osaka': 'plane' } }
  const context = plan.lodgingContext(route, 1, stopOf, 'car')
  assert.equal(context.side, 'move')
  assert.equal(context.move.mode, 'plane')
  const hotel = { name: '大阪のホテル', location: { lat: 34.6937, lng: 135.5023 }, lodgingKind: 'hotel' }
  const fit = plan.lodgingFit(context, hotel.location, 'hotel')
  assert.ok(fit.ok, `大阪のホテルが外れた（着く ${plan.clockText(fit.arriveAt)}、寄り道 ${fit.detour} 分）`)
  assert.deepEqual(plan.rankLodgings(context, [hotel]).map((place) => place.name), ['大阪のホテル'])
  delete PLACES.osaka
})

test('宿さがし：予定が遅くまで続く夜（21:00 より後に最後の場所を出る）は、最後の場所から 30 分以内のホテルを出す。旅館は出ない（#631 のレビュー）', () => {
  const context = plan.lodgingContext(tokyoToSapporo('21:30'), 1, stopOf, 'car')
  assert.equal(context.side, 'stay')
  const hamamatsucho = { name: '浜松町のホテル', location: { lat: 35.6553, lng: 139.757 }, lodgingKind: 'hotel' }
  const yokohama = { name: '横浜のホテル', location: { lat: 35.4658, lng: 139.6223 }, lodgingKind: 'hotel' }
  const ryokan = { name: '東京の旅館', location: { lat: 35.66, lng: 139.75 }, lodgingKind: 'ryokan' }
  assert.deepEqual(plan.rankLodgings(context, [yokohama, ryokan, hamamatsucho]).map((place) => place.name), ['浜松町のホテル'])
})

test('宿さがし：行き先の側に移るのは、移ったあと宿までの移動を見込んでも 21:00 に間に合うときだけ（#631 のレビュー）', () => {
  const early = plan.lodgingContext(tokyoToSapporo('12:00'), 1, stopOf, 'car')
  const minutes = early.move.minutes
  const at = (leave) => plan.lodgingContext({ schedule: [row(1, '10:00', 'tower', leave - 600), row(2, '10:00', 'clock', 60)], lodging: {} }, 1, stopOf, 'car')
  // ちょうど 21:00 に着く出発では、宿まで移る時間がないので出発の側
  assert.equal(at(21 * 60 - minutes).side, 'stay')
  assert.equal(at(21 * 60 - minutes - plan.LODGING_HOP_MINUTES).side, 'move')
  // 行き先の側を選んだ境目でも、行き先の近くのホテルが残る
  const edge = at(21 * 60 - minutes - plan.LODGING_HOP_MINUTES)
  const sapporo = { name: '札幌のホテル', location: { lat: 43.0686, lng: 141.3508 }, lodgingKind: 'hotel' }
  assert.deepEqual(plan.rankLodgings(edge, [sapporo]).map((place) => place.name), ['札幌のホテル'])
})

test('宿さがし：遅い夜の上限は、境目の前後で狭まらない。名前で頼まれた宿のうち、ふるわずに残すのは先頭の 1 件だけ（#631 のレビュー）', () => {
  assert.equal(plan.hotelArriveBy(20 * 60), 21 * 60)
  assert.equal(plan.hotelArriveBy(20 * 60 + 30), 21 * 60)
  assert.equal(plan.hotelArriveBy(20 * 60 + 45), 21 * 60 + 15)
  for (let leave = 20 * 60; leave < 22 * 60; leave += 1) assert.ok(plan.hotelArriveBy(leave + 1) - (leave + 1) >= Math.min(30, 21 * 60 - leave - 1))
  const context = plan.lodgingContext(tokyoToSapporo('17:50'), 1, stopOf, 'car')
  const first = { name: '頼んだ宿', location: { lat: 40.8285, lng: 140.7346 }, namedMatch: true }
  const second = { name: '青森の 2 件目', location: { lat: 40.83, lng: 140.73 }, namedMatch: true }
  const tokyo = { name: '浜松町のホテル', location: { lat: 35.6553, lng: 139.757 }, lodgingKind: 'hotel' }
  const ranked = plan.rankLodgings(context, [first, second, tokyo])
  assert.deepEqual(ranked.map((place) => place.name), ['頼んだ宿', '浜松町のホテル'])
  assert.equal(ranked[1].namedMatch, undefined)
})

test('宿さがし：ホテルでも、21:00 を過ぎて着く宿は出ない', () => {
  // 東京タワーから 40 分ほどの船橋のホテル。20:30 に出ると 21:00 を過ぎて着くので出ない（寄り道は 45 分の中なので、外れるのは着く時刻のため）
  const funabashi = { lat: 35.7016, lng: 139.9853 }
  const late = plan.lodgingFit(plan.lodgingContext(tokyoToSapporo('20:30'), 1, stopOf, 'car'), funabashi, 'hotel')
  assert.ok(late.arriveAt > 21 * 60)
  assert.ok(late.detour <= plan.DETOUR_MAX_MINUTES)
  assert.equal(late.ok, false)
  // 20:00 に出れば間に合う
  assert.equal(plan.lodgingFit(plan.lodgingContext(tokyoToSapporo('20:00'), 1, stopOf, 'car'), funabashi, 'hotel').ok, true)
})

test('宿さがし：短い移動の夜は、今までどおり 2 つの場所のあいだで探す（車の旅は道の途中）。翌日の場所がなければ最後の場所の側', () => {
  const route = { schedule: [row(1, '10:00', 'castle', 420), row(2, '09:00', 'wasabi', 60)], lodging: {} }
  assert.equal(plan.lodgingContext(route, 1, stopOf, 'car').side, 'route')
  const between = plan.lodgingContext(route, 1, stopOf, 'transit')
  assert.equal(between.side, 'between')
  assert.equal(between.from.leaveAt, 17 * 60)
  const last = plan.lodgingContext({ schedule: [row(1, '10:00', 'castle', 420)], lodging: {} }, 1, stopOf, 'car')
  assert.equal(last.side, 'stay')
  assert.equal(last.next, null)
  // しおりに場所がなければ、様子は作らない（地図の範囲で探す）
  assert.equal(plan.lodgingContext({ schedule: [], lodging: {} }, 1, stopOf, 'car'), null)
  // もう決まった宿の行は、最後の場所にしない
  const withLodging = { schedule: [row(1, '10:00', 'castle', 60), row(1, '12:00', 'wasabi', 60), row(2, '09:00', 'tower', 60)], lodging: { 1: 'wasabi' } }
  assert.equal(plan.lodgingContext(withLodging, 1, stopOf, 'car').from.name, '松本城')
})

test('宿さがし：車の旅で車で移る夜は、長い移動でもどちらかの側に寄せず、21:00 までに着ける道の途中ならどこでも探す（Takana の依頼、2026-11-22）', () => {
  // 東京タワー → 松本城（車で約 4 時間）。17:00 に出る
  const drive = (leave) => ({ schedule: [row(1, '10:00', 'tower', leave - 600), row(2, '10:00', 'castle', 60)], lodging: {} })
  const context = plan.lodgingContext(drive(17 * 60), 1, stopOf, 'car')
  assert.equal(context.side, 'route')
  assert.equal(context.move.mode, 'car')
  assert.ok(context.move.minutes > plan.LONG_MOVE_MINUTES, '長い移動の例になっていない')
  // 21:00 までに松本に着けるので、探す範囲は東京から松本まで
  assert.ok(context.bounds.west <= 137.97 && context.bounds.east >= 139.74, '道の全体を探していない')
  const tokyo = { name: '浜松町のホテル', location: { lat: 35.6553, lng: 139.757 }, lodgingKind: 'hotel' }
  const middle = { name: '道の途中のホテル', location: { lat: 35.95, lng: 138.86 }, lodgingKind: 'hotel' }
  const matsumoto = { name: '松本駅のホテル', location: { lat: 36.2308, lng: 137.9644 }, lodgingKind: 'hotel' }
  const aside = { name: '道から外れたホテル', location: { lat: 35.1, lng: 138.86 }, lodgingKind: 'hotel' }
  assert.deepEqual(plan.rankLodgings(context, [tokyo, middle, matsumoto, aside]).map((place) => place.name).sort(), ['松本駅のホテル', '浜松町のホテル', '道の途中のホテル'])
  // 電車・バスの旅なら、今までどおり長い移動の途中には泊まらない
  assert.notEqual(plan.lodgingContext(drive(17 * 60), 1, stopOf, 'transit').side, 'route')
  // 19:30 に出ると、21:00 までに進めるのは道の途中まで。範囲は松本まで広げず、着けない松本のホテルは出ない
  const late = plan.lodgingContext(drive(19 * 60 + 30), 1, stopOf, 'car')
  assert.equal(late.side, 'route')
  assert.ok(late.bounds.west > 137.97 + 0.3, '着けない所まで探している')
  assert.equal(plan.lodgingFit(late, matsumoto.location, 'hotel').ok, false)
  assert.equal(plan.lodgingFit(late, tokyo.location, 'hotel').ok, true)
  assert.equal(plan.reachableFraction(17 * 60, 120), 1)
  assert.equal(plan.reachableFraction(20 * 60, 120), 0.5)
})

test('宿さがし：着く時刻（旅館 18:00、ホテル 21:00）と寄り道（45 分）でふるい、寄り道の短い順に並べる。名前で頼んだ宿は残す', () => {
  const context = plan.lodgingContext(tokyoToSapporo('17:50'), 1, stopOf, 'car')
  assert.equal(context.side, 'stay')
  const hamamatsucho = { name: '浜松町のホテル', location: { lat: 35.6553, lng: 139.757 }, lodgingKind: 'hotel' }
  const shinagawa = { name: '品川のホテル', location: { lat: 35.6285, lng: 139.7387 }, lodgingKind: 'hotel' }
  const aomori = { name: '青森のホテル', location: { lat: 40.8285, lng: 140.7346 }, lodgingKind: 'hotel' }
  const ryokan = { name: '東京の旅館', location: { lat: 35.66, lng: 139.75 }, lodgingKind: 'ryokan' }
  const named = { name: '青森の頼んだ宿', location: { lat: 40.8285, lng: 140.7346 }, namedMatch: true }
  const ranked = plan.rankLodgings(context, [aomori, shinagawa, ryokan, hamamatsucho, named])
  // 名前で頼んだ宿が先頭。そのあとは東京の側のホテル（寄り道の短い順。どちらも同じくらい）。旅館と青森のホテルは出ない
  assert.equal(ranked[0].name, '青森の頼んだ宿')
  assert.deepEqual(ranked.slice(1).map((place) => place.name).sort(), ['品川のホテル', '浜松町のホテル'])
  // 遠回りになる宿は、寄り道の短い宿より後ろに並ぶ
  const yokohama = { name: '横浜のホテル', location: { lat: 35.4658, lng: 139.6223 }, lodgingKind: 'hotel' }
  const order = plan.rankLodgings(context, [yokohama, hamamatsucho]).map((place) => place.name)
  assert.equal(order[0], '浜松町のホテル')
  // 17:50 に出ると、近くの旅館でも 18:00 までに着けないので出ない。ホテルなら 21:00 までに着く
  assert.equal(plan.lodgingFit(context, ryokan.location, 'ryokan').ok, false)
  assert.equal(plan.lodgingFit(context, ryokan.location, 'hotel').ok, true)
  // 札幌の側に泊まる夜は、東京の宿も、途中の青森の宿も出ず、札幌の宿が出る
  const early = plan.lodgingContext(tokyoToSapporo('12:00'), 1, stopOf, 'car')
  const sapporo = { name: '札幌のホテル', location: { lat: 43.0686, lng: 141.3508 }, lodgingKind: 'hotel' }
  assert.deepEqual(plan.rankLodgings(early, [hamamatsucho, aomori, sapporo]).map((place) => place.name), ['札幌のホテル'])
})

test('宿さがし：Places の結果から、宿でない・遠すぎる・（車の旅で）駐車場がない候補を外し、位置と placeId を Places のものにする', () => {
  const context = plan.lodgingContext(tokyoToSapporo('17:50'), 1, stopOf, 'car')
  const place = { name: '浜松町のホテル', location: { lat: 35.6553, lng: 139.757 }, lodgingKind: 'hotel' }
  const found = { placeId: 'abc', location: { lat: 35.656, lng: 139.758 }, lodging: true, ryokan: false, parking: true }
  assert.deepEqual(plan.acceptLodging(context, place, found, true), { ...place, location: found.location, placeId: 'abc', lodgingKind: 'hotel' })
  assert.equal(plan.acceptLodging(context, place, { ...found, lodging: false }, true), null, '宿でない場所を残した')
  assert.equal(plan.acceptLodging(context, place, { ...found, location: { lat: 35.9, lng: 139.9 } }, true), null, '20 km より離れた別の場所を残した')
  assert.equal(plan.acceptLodging(context, place, { ...found, parking: false }, true), null, '駐車場のない宿を車の旅に残した')
  assert.ok(plan.acceptLodging(context, place, { ...found, parking: false }, false), '電車の旅で駐車場を見た')
  assert.ok(plan.acceptLodging(context, place, { ...found, parking: null }, true), '駐車場が分からない宿を外した')
  // 種類が分からない候補は、Places が旅館と言えば旅館として、着く時刻を確かめ直す（17:50 に出て 18:00 までには着かない）
  assert.equal(plan.acceptLodging(context, { ...place, lodgingKind: undefined }, { ...found, ryokan: true }, true), null)
})

test('宿さがし：Places の応答から、宿の種類と駐車場を読む', () => {
  const body = (extra) => ({ places: [{ id: 'p1', location: { latitude: 35.6, longitude: 139.7 }, ...extra }] })
  assert.deepEqual(parseFoundLodging(body({ types: ['japanese_inn', 'lodging'], parkingOptions: { freeParkingLot: true } })), {
    placeId: 'p1', location: { lat: 35.6, lng: 139.7 }, lodging: true, ryokan: true, parking: true,
  })
  assert.deepEqual(parseFoundLodging(body({ types: ['restaurant'], parkingOptions: { freeParkingLot: false, paidParkingLot: false } })), {
    placeId: 'p1', location: { lat: 35.6, lng: 139.7 }, lodging: false, ryokan: false, parking: false,
  })
  assert.equal(parseFoundLodging(body({ types: ['hotel'] })).parking, null)
  assert.equal(parseFoundLodging({ places: [] }), null)
})

test('宿さがし：Gemini に、最後の場所と出る時刻、翌日の場所、移動の手段、泊まる側、着く時刻の上限を添える', () => {
  const context = { night: 1, side: 'stay', fromName: '東京タワー', leaveAt: '20:00', nextName: '札幌市時計台', moveMode: 'plane', tripMode: 'car', hotelBy: '21:00' }
  const prompt = suggestPlacesTask.prompt({ text: '1 日目の宿', bounds: null, exclude: [], lodging: true, lodgingContext: context })
  for (const word of ['東京タワー', '20:00', '札幌市時計台', '飛行機', '翌朝', '18:00', '21:00', '駐車場', 'lodgingKind']) assert.ok(prompt.includes(word), `${word} がない`)
  assert.ok(prompt.includes('候補は 6 件まで'))
  const move = suggestPlacesTask.prompt({ text: '1 日目の宿', bounds: null, exclude: [], lodging: true, lodgingContext: { ...context, side: 'move', tripMode: 'transit' } })
  assert.ok(move.includes('その夜のうちに移って') && move.includes('駅から歩ける'))
  const route = suggestPlacesTask.prompt({ text: '1 日目の宿', bounds: null, exclude: [], lodging: true, lodgingContext: { ...context, side: 'route', nextName: '松本城', moveMode: 'car' } })
  assert.ok(route.includes('車で向かう道の途中なら、どこでも') && route.includes('21:00 までに着ける'))
  // 予定が遅い夜は、ホテルの上限も遅い時刻で頼む（ふるう上限とそろえる）
  const late = suggestPlacesTask.prompt({ text: '1 日目の宿', bounds: null, exclude: [], lodging: true, lodgingContext: { ...context, leaveAt: '21:30', hotelBy: '22:00' } })
  assert.ok(late.includes('ホテルは 22:00 までに'))
  // しおりの様子がなければ、今までどおり 2 つの場所のあいだを頼み、候補は 3 件まで
  const plain = suggestPlacesTask.prompt({ text: '1 日目の宿', bounds: null, exclude: [], lodging: true })
  assert.ok(plain.includes('その 2 つのあいだ') && plain.includes('候補は 3 件まで'))
})

test('宿さがし：Places で確かめるのは、本物の Gemini の候補で、呼べる設定で、合言葉を通した人の希望だけ。3 件まで', async () => {
  const context = plan.lodgingContext(tokyoToSapporo('17:00'), 1, stopOf, 'car')
  const hotel = (name, lat, lng) => ({ name, description: '', area: '東京都港区', category: 'lodging', location: { lat, lng }, lodgingKind: 'hotel' })
  const candidates = [hotel('A', 35.6553, 139.757), hotel('B', 35.6285, 139.7387), hotel('C', 35.66, 139.75), hotel('D', 35.665, 139.76)]
  const calls = []
  const answers = { A: { placeId: 'pa', location: { lat: 35.6553, lng: 139.757 }, lodging: true, ryokan: false, parking: true }, B: 'not-found', C: null, D: null }
  const placesApi = { enabled: () => true, findLodging: async (query) => (calls.push(query), answers[query.text.split(' ')[0]]) }
  const gate = (unlocked) => ({ isOpenToAll: async () => false, isUnlocked: async () => unlocked })
  const options = (provider) => ({ provider, uid: 'u', tripMode: 'car' })

  const kept = await settleLodgings({ placesApi, aiGate: gate(true) }, context, candidates, options('agy'))
  assert.equal(calls.length, 3, '3 件より多く Places を呼んだ')
  assert.ok(calls.every((query) => query.parking === true), '車の旅で駐車場を聞いていない')
  // 寄り道の短い順に 3 件を確かめる。見つかった宿には placeId が付き、見つからない宿は外し、呼べなかった宿は確かめずに残す
  const names = kept.map((place) => place.name)
  assert.ok(calls.some((query) => query.text.startsWith('B ')), 'B を Places で確かめていない')
  assert.ok(!names.includes('B'), '見つからない宿を残した')
  assert.equal(kept.find((place) => place.name === 'A')?.placeId, 'pa')
  // 確かめた宿で 3 件に足りないので、確かめていない残り（D）を足す
  assert.equal(kept.length, 3)
  assert.ok(names.includes('D'))
  assert.equal(kept.find((place) => place.name === 'D')?.placeId, undefined)

  calls.length = 0
  assert.equal((await settleLodgings({ placesApi, aiGate: gate(false) }, context, candidates, options('agy'))).length, 3)
  assert.equal((await settleLodgings({ placesApi, aiGate: gate(true) }, context, candidates, options('stub'))).length, 3)
  assert.equal((await settleLodgings({ placesApi: { ...placesApi, enabled: () => false }, aiGate: gate(true) }, context, candidates, options('agy'))).length, 3)
  assert.equal((await settleLodgings({ aiGate: gate(true) }, context, candidates, options('agy'))).length, 3)
  assert.equal(calls.length, 0, '確かめない設定で Places を呼んだ')
})
