// しおりのごはんの枠（functions/src/domain/meal.ts、features/propose-routes の addToDecidedRoute、suggest-places のお店さがし）を、
// Emulator なしで確かめる。scripts/functions.test.mjs から読み込む（npm run build のあと）
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { assignMeal, isMealSkip, mealInsertIndex, mealKey, mealSkipValue, mealsAfterSkip, parseMealKey } = require('../functions/lib/domain/meal.js')
const { mealSlotOf } = require('../functions/lib/domain/wish.js')
const { planPlace } = require('../functions/lib/domain/routePlan.js')
const { addToDecidedRoute } = require('../functions/lib/features/propose-routes/logic.js')
const suggest = require('../functions/lib/features/suggest-places/logic/index.js')
const { suggestPlacesTask } = require('../functions/lib/features/suggest-places/prompt.js')

const ORIGIN = { name: '松本駅', location: { lat: 36.2308, lng: 137.9644 }, travelMode: 'car' }
const WASABI = { id: 'wasabi', name: '大王わさび農場', location: { lat: 36.337, lng: 137.91 }, uid: 'u1' }
const CASTLE = { id: 'castle', name: '松本城', location: { lat: 36.2386, lng: 137.9689 }, uid: 'u2' }
const ZENKOJI = { id: 'zenkoji', name: '善光寺', location: { lat: 36.6617, lng: 138.1876 }, uid: 'u1' }
const SOBA = { id: 'soba', name: '戸隠そば', location: { lat: 36.741, lng: 138.085 }, uid: 'u3', category: 'food' }
const ids = (order) => order.map((place) => place.id)
const stop = (day, time, pinId) => ({ day, time, pinId, name: pinId, stayMinutes: 60, moveMinutesToNext: null })

test('ごはんの枠：キーは「日-食事」の形だけを受け取り、決めた印は宿と同じ形', () => {
  assert.equal(mealKey(2, 'dinner'), '2-dinner')
  assert.deepEqual(parseMealKey('1-lunch'), { day: 1, meal: 'lunch' })
  for (const bad of ['0-lunch', '32-lunch', '1-snack', '01-lunch', 'lunch', 1, undefined]) assert.equal(parseMealKey(bad), null, String(bad))
  assert.equal(mealSkipValue(null), '@skip')
  assert.equal(mealSkipValue(' コンビニ '), '@skip:コンビニ')
  assert.equal(isMealSkip('@skip:なし'), true)
  assert.equal(isMealSkip('soba'), false)
  assert.equal(mealSlotOf({ mealSlot: '3-breakfast' }), '3-breakfast')
  assert.equal(mealSlotOf({ mealSlot: '3-snack' }), null)
  assert.equal(mealSlotOf({}), null)
  // ごはんとして探したピンは、しおりを組む計算に枠を渡す
  assert.equal(planPlace('soba', { name: '戸隠そば', location: SOBA.location, uid: 'u3', category: 'food', mealSlot: '1-lunch' }).meal, '1-lunch')
  assert.equal('meal' in planPlace('castle', { name: '松本城', location: CASTLE.location, uid: 'u2', category: 'shrine' }), false)
})

test('ごはんの枠：お店を入れる位置は、朝はその日の最初、昼は 12 時、晩は 18 時より前に着く最後の場所のあと', () => {
  const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'inn' }, { id: 'd' }]
  const schedule = [stop(1, '09:30', 'a'), stop(1, '11:00', 'b'), stop(1, '15:00', 'c'), stop(1, '19:00', 'inn'), stop(2, '10:00', 'd')]
  assert.equal(mealInsertIndex(order, schedule, { day: 1, meal: 'breakfast' }, ['inn']), 0)
  assert.equal(mealInsertIndex(order, schedule, { day: 1, meal: 'lunch' }, ['inn']), 2)
  // 晩は、宿の行の前
  assert.equal(mealInsertIndex(order, schedule, { day: 1, meal: 'dinner' }, ['inn']), 3)
  // 2 日目の朝は、前の夜の宿のあと（その日の最初の場所の前）
  assert.equal(mealInsertIndex(order, schedule, { day: 2, meal: 'breakfast' }, ['inn']), 4)
  // 12 時より前に着く場所がなければ、その日の最初の場所の前
  assert.equal(mealInsertIndex(order, [stop(1, '13:00', 'a')], { day: 1, meal: 'lunch' }), 0)
  // その日に場所がなければ、それより前の日の最後の場所のあと。それもなければ先頭
  assert.equal(mealInsertIndex(order, schedule, { day: 3, meal: 'lunch' }, ['inn']), 5)
  assert.equal(mealInsertIndex([], [], { day: 1, meal: 'dinner' }), 0)
})

test('ごはんの枠：建ったお店は、その日のそのごはんの位置に入り、枠に残る', () => {
  const route = {
    style: 'shortest',
    pinIds: ['wasabi', 'castle', 'zenkoji'],
    revision: 0,
    addedPinIds: [],
    schedule: [stop(1, '09:30', 'wasabi'), stop(1, '11:30', 'castle'), stop(1, '14:00', 'zenkoji')],
  }
  const added = addToDecidedRoute(route, [WASABI, CASTLE, ZENKOJI, { ...SOBA, meal: '1-lunch' }], ORIGIN, 1)
  assert.deepEqual(added.pinIds, ['wasabi', 'castle', 'soba', 'zenkoji'])
  assert.deepEqual(added.meals, { '1-lunch': 'soba' })
  assert.equal(added.revision, 1)
  // その枠にもうお店があれば、ふつうの場所として足す（枠は前のまま）
  const second = { ...SOBA, id: 'soba2', meal: '1-lunch' }
  const again = addToDecidedRoute({ ...route, ...added }, [WASABI, CASTLE, ZENKOJI, { ...SOBA, meal: '1-lunch' }, second], ORIGIN, 1)
  assert.equal(again.pinIds.length, 5)
  assert.deepEqual(again.meals, undefined)
  // ごはんでない場所だけを足すときは、meals を書かない
  const plain = addToDecidedRoute(route, [WASABI, CASTLE, ZENKOJI, { ...SOBA, id: 'x' }], ORIGIN, 1)
  assert.equal('meals' in plain, false)
  // 前に決めた印（なし）の枠に建てたら、お店で置き換える
  assert.deepEqual(assignMeal([WASABI], { ...SOBA, meal: '1-dinner' }, {}, { '1-dinner': '@skip:なし' }, []).meals, { '1-dinner': 'soba' })
  // お店がしおりからなくなった枠は、空いているとみなす（時刻の分からない場所は、その日の場所に数えないので先頭）
  assert.deepEqual(ids(assignMeal([WASABI], { ...SOBA, meal: '1-dinner' }, {}, { '1-dinner': 'gone' }, []).order), ['soba', 'wasabi'])
})

test('ごはんの枠：お店を建てずに決める・空の枠に戻す', () => {
  const route = { pinIds: ['wasabi', 'soba'], revision: 2, meals: { '1-lunch': 'soba' } }
  assert.deepEqual(mealsAfterSkip(route, 2, '1-dinner', true, 'なし'), { meals: { '1-lunch': 'soba', '1-dinner': '@skip:なし' }, revision: 3 })
  assert.deepEqual(mealsAfterSkip({ ...route, meals: { '1-dinner': '@skip' } }, 2, '1-dinner', false), { meals: {}, revision: 3 })
  assert.equal(mealsAfterSkip({ ...route, meals: { '1-dinner': '@skip:なし' } }, 2, '1-dinner', true, 'なし'), 'unchanged')
  // お店がしおりにある枠は変えられない。お店が消えた枠は上書きできる
  assert.equal(mealsAfterSkip(route, 2, '1-lunch', true), 'decided')
  assert.equal(typeof mealsAfterSkip({ ...route, pinIds: ['wasabi'] }, 2, '1-lunch', true), 'object')
  // 日程にない日、形の違うキー
  assert.equal(mealsAfterSkip(route, 2, '3-lunch', true), 'invalid')
  assert.equal(mealsAfterSkip(route, 2, '1-snack', true), 'invalid')
})

test('ごはんの枠：お店さがしは、食べものの場所と街の駅前から、範囲の真ん中に近い順に出す', () => {
  const nagano = { north: 36.8, south: 36.6, east: 138.3, west: 138.0 }
  const places = suggestPlacesTask.stub({ text: '1 日目の昼ごはん', bounds: nagano, exclude: [], meal: 'lunch' }).places
  assert.equal(places.length, 3)
  for (const place of places) assert.equal(place.category, 'food', place.name)
  assert.ok(places.some((place) => place.name === '戸隠そば' || place.name === '長野駅周辺のお店'), places.map((place) => place.name).join('、'))
  // 旅の県の外は出さない
  const tokyo = suggest.searchMeals({ text: '1 日目の晩ごはん', bounds: nagano, exclude: [], prefectures: ['東京都'] })
  for (const place of tokyo) assert.ok(place.area.startsWith('東京都'), place.area)
  // プロンプトは、その時間に食べられるお店だけを頼み、模型の一覧を渡さない
  const prompt = suggestPlacesTask.prompt({ text: '1 日目の朝ごはん', bounds: nagano, exclude: [], meal: 'breakfast' })
  assert.match(prompt, /朝ごはん/)
  assert.match(prompt, /category は food/)
  assert.doesNotMatch(prompt, /模型が用意してあります/)
})

test('ごはんの枠：時刻が決まったイベントがあっても、お店はその枠の位置に入れる（イベントを入れ直してお店を夜に回さない。間に合わないことはしおりが赤で知らせる）', () => {
  const SATURDAY = '2026-11-28'
  const origin = { ...ORIGIN, startDate: SATURDAY }
  const fireworks = { ...planPlace('fireworks', { name: '見本の花火大会', location: { lat: 36.05, lng: 138.09 }, uid: 'u1', category: 'nightview' }), event: { kind: 'fireworks', date: SATURDAY, start: 19 * 60 + 30, end: 20 * 60 + 30, leadMinutes: 60, source: '見本' } }
  const far = { id: 'far', name: '遠くのお店', location: { lat: 34.69, lng: 135.5 }, uid: 'u3', category: 'food', meal: '1-lunch' }
  const route = { style: 'shortest', pinIds: ['castle', 'fireworks'], revision: 1, addedPinIds: [], lodging: undefined, schedule: [stop(1, '09:15', 'castle'), stop(1, '18:30', 'fireworks')] }
  const added = addToDecidedRoute(route, [CASTLE, fireworks, far], origin, 1)
  assert.deepEqual(added.pinIds, ['castle', 'far', 'fireworks'])
  assert.deepEqual(added.meals, { '1-lunch': 'far' })
})

test('ごはんの枠：枠の日が今の日程の外（探したあとで日程を短くした）なら、枠に入れず、ふつうの場所として足す', () => {
  const route = { style: 'shortest', pinIds: ['castle'], revision: 1, addedPinIds: [], lodging: undefined, schedule: [stop(1, '09:15', 'castle')] }
  const added = addToDecidedRoute(route, [CASTLE, { ...SOBA, meal: '3-lunch' }], ORIGIN, 2)
  assert.ok(added.pinIds.includes('soba'))
  assert.equal(added.meals, undefined)
})
