// web の純粋な関数を、ブラウザなしで確かめる。web にはテストの道具を入れていないので、
// Node 24 の型の取り除きで .ts をそのまま読む（型だけの書き方の .ts に限る）。
// 使い方：node --test scripts/web.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import './sound.test.mjs'
import './shiori-cost.test.mjs'
import { mealSlotIndex } from '../web/src/entities/route/model/meal.ts'
import { LODGING_SKIP, lodgingNights, lodgingSearchBounds, lodgingStopIds, openLodgingNight, previousLodging } from '../web/src/entities/route/model/lodging.ts'
import { closedNights, hintNight } from '../web/src/features/pick-lodging/model/hint.ts'
import { swipeTarget } from '../web/src/shared/lib/swipe.ts'
import { bookingSearchUrl } from '../web/src/features/place-reviews/model/lodgingLinks.ts'
import { ownerUidOf } from '../web/src/entities/member/model/owner.ts'
import { isConfirmed, isPastTrip } from '../web/src/entities/trip/model/confirmed.ts'
import { stepAfter, tapMove } from '../web/src/widgets/tutorial/model/steps.ts'
import { joinCodeProblem, normalizeJoinCode } from '../web/src/entities/trip/model/joinCode.ts'
import { errorCode, linkProblem } from '../web/src/features/link-google/model/linkProblem.ts'
import { encodeLinkOutcome, parseLinkOutcome } from '../web/src/shared/api/linkOutcome.ts'
import { isSwitchingAccount, markSwitching, subscribeSwitching } from '../web/src/shared/api/switching.ts'
import { settledAfterAnimation, sheetPhase } from '../web/src/shared/lib/sheetPhase.ts'
import { ARRIVE_MS, DRIVE_MAX_MS, DRIVE_MIN_MS, driveMs, easeInOut, nextArrivalAt, nextTourSpeed, TOUR_SPEEDS, tourStepAt, tourSteps, tourVehicleOf } from '../web/src/pages/trip-map/model/tour.ts'
import { bearing, legEndSize, legZoom, makeLeg, placeAlong, tourMotion } from '../web/src/widgets/trip-map/lib/tourPath.ts'
import { autoScrollStep, insertionAt, pressMovedTooFar } from '../web/src/widgets/route-timeline/lib/stopDrag.ts'
import { movedRoute } from '../web/src/features/reorder-shiori/model/move.ts'
import { skyAtTime } from '../web/src/features/shiori-weather/model/skyAt.ts'
import { pinOfStop, stopIdOf, visitCounts } from '../web/src/entities/route/model/visits.ts'
import {
  isAllRegions,
  normalizeRegions,
  REGION_IDS,
  regionsLabel,
  regionsProblem,
  regionsShortLabel,
  toggleRegion,
  pickedLabel,
  pickedShortLabel,
  pickedFromTrip,
  toggleRegionPrefectures,
  togglePrefecture,
  toTripArea,
  searchAreas,
  setRegionPrefectures,
} from '../web/src/entities/trip/model/regions.ts'
import { regionRings } from '../web/src/entities/trip/model/regionShapes.ts'
import { shioriBookDays, shioriBookFileName, shioriBookHasPlaces, shioriBookOf, shioriBookPlaceNames } from '../web/src/entities/trip/model/shioriBook.ts'
import { jpegPagesToPdf } from '../web/src/shared/lib/pdf.ts'
import { clockAfter, clockFromDigits, clockLabel, clockMinutes, formatClockDigits, nextClockDigits, pushClockDigit } from '../web/src/shared/lib/clock.ts'
import { PAGE, paginate, wrapText } from '../web/src/features/export-shiori-pdf/lib/drawPages.ts'
import { calendarDayUrl, calendarEvents, eventsByDate } from '../web/src/features/export-calendar/lib/events.ts'
import { builtState } from '../web/src/pages/trip-map/model/builtState.ts'
import { tourEndView, tripMapView } from '../web/src/pages/trip-map/model/mapView.ts'
import { fitFrame, turntableFrame } from '../web/src/entities/model3d/lib/turntableFrame.ts'

test('場所の情報：右から左へスワイプすると次の場所', () => {
  assert.equal(swipeTarget(-120, 5), 'next')
  assert.equal(swipeTarget(-60, 0), 'next')
})

test('場所の情報：左から右へスワイプすると前の場所', () => {
  assert.equal(swipeTarget(120, 5), 'prev')
  assert.equal(swipeTarget(60, 0), 'prev')
})

test('場所の情報：短い動き、縦や斜めの動きはスワイプではない', () => {
  assert.equal(swipeTarget(-30, 0), null)
  assert.equal(swipeTarget(30, 200), null)
  assert.equal(swipeTarget(-100, 80), null)
})

test('場所の情報のシート：開いたとき、出てきた理由どおりに動く', () => {
  assert.equal(sheetPhase(false, null, 'open', false), 'open')
  assert.equal(sheetPhase(false, null, 'switch', false), 'switch')
})

test('場所の情報のシート：閉じるときは下がる動きを通ってから、閉じた状態になる', () => {
  assert.equal(sheetPhase(true, 'full', 'open', false), 'closing')
  assert.equal(sheetPhase(true, null, 'open', false), 'closing')
  assert.equal(settledAfterAnimation(true), 'peek')
  assert.equal(sheetPhase(true, 'peek', 'open', false), 'peek')
})

test('場所の情報のシート：閉じた状態から開くときは上がり、終われば止まる', () => {
  assert.equal(sheetPhase(false, 'peek', 'open', false), 'expand')
  assert.equal(settledAfterAnimation(false), 'full')
  assert.equal(sheetPhase(false, 'full', 'open', false), 'rest')
})

test('場所の情報のシート：動きを減らす設定では、閉じるときに動きを待たない', () => {
  assert.equal(sheetPhase(true, 'full', 'open', true), 'peek')
  assert.equal(sheetPhase(true, null, 'switch', true), 'peek')
})

// 下のシートのドラッグ（import は巻き上げられる。fix/shiori-map-touch が上の import を触るので、ぶつけないようここに置く）
import { dragAxis, dragGrow, dragOffset, dragSettle, foldOpenness } from '../web/src/shared/lib/sheetDrag.ts'
import { halfSheetLimit } from '../web/src/pages/trip-map/model/tallSheet.ts'

test('下のシート：開いた形が 2 段のシートは、上へ引くと大きくなる（少しの動きや下向きでは大きくしない）', () => {
  assert.equal(dragGrow(-60, 0), true)
  assert.equal(dragGrow(-20, 0), false, '少し動いただけで大きくした')
  assert.equal(dragGrow(-20, -0.8), true, '上へはじいたのに大きくならない')
  assert.equal(dragGrow(60, 0), false)
  assert.equal(dragGrow(-5, -2), false, '押しただけで大きくした')
})

test('下のシートのドラッグ：指について動く量は、開いた状態からは下へ、閉じた状態からは上へ、範囲まで', () => {
  assert.equal(dragOffset('full', 120, 400), 120)
  assert.equal(dragOffset('full', -50, 400), 0)
  assert.equal(dragOffset('full', 900, 400), 400)
  assert.equal(dragOffset('peek', -120, 400), -120)
  assert.equal(dragOffset('peek', 50, 400), 0)
  assert.equal(dragOffset('peek', -900, 400), -400)
})

test('下のシートのドラッグ：伸ばせるシート（しおり）は、開いた状態から上へも、伸ばせる量まで指についていく', () => {
  // 伸ばせる量を渡さなければ、上へは動かない（場所の情報のシート）
  assert.equal(dragOffset('full', -50, 400), 0)
  assert.equal(dragOffset('full', -50, 400, 300), -50)
  assert.equal(dragOffset('full', -900, 400, 300), -300)
  // 下へ動かす量と、閉じた状態からの動きは変わらない
  assert.equal(dragOffset('full', 120, 400, 300), 120)
  assert.equal(dragOffset('peek', -120, 400, 300), -120)
})

test('しおりのシート：ふつうの高さの上限は、画面の 52% と下の欄（ページの 78%）の小さいほう。低い画面では下の欄だけ', () => {
  assert.equal(halfSheetLimit(844, 832), 844 * 0.52)
  // ページが低いとき（枠や、ブラウザの帯で）は、下の欄の上限が先に効く
  assert.equal(halfSheetLimit(844, 500), 500 * 0.78)
  // 横向きなど低い画面では、画面の半分の上限を外す（ShioriSheet.module.css の @media と同じ）
  assert.equal(halfSheetLimit(400, 388), 388 * 0.78)
})

test('下のシートのドラッグ：範囲の 3 割を超えて動かすと、向こうの状態へ吸い付く', () => {
  assert.equal(dragSettle('full', 130, 0, 400), 'peek')
  assert.equal(dragSettle('full', 100, 0, 400), 'full')
  assert.equal(dragSettle('peek', -130, 0, 400), 'full')
  assert.equal(dragSettle('peek', -100, 0, 400), 'peek')
  // 範囲が小さいときも、40px は動かす
  assert.equal(dragSettle('full', 30, 0, 80), 'full')
  assert.equal(dragSettle('full', 45, 0, 80), 'peek')
})

test('下のシートのドラッグ：勢いよくはじくと、短い距離でもその向きへ動く', () => {
  assert.equal(dragSettle('full', 20, 0.8, 400), 'peek')
  assert.equal(dragSettle('peek', -20, -0.8, 400), 'full')
  // 向こうと逆向きにはじいても、動かない
  assert.equal(dragSettle('full', 20, -0.8, 400), 'full')
})

test('下のシートのドラッグ：取っ手を軽く押すと、開く・閉じるが切り替わる', () => {
  assert.equal(dragSettle('full', 2, 0, 400), 'peek')
  assert.equal(dragSettle('peek', -3, 0, 400), 'full')
})

// 建物のカードのスワイプで移る、旅の前後の建物（#117）
import { adjacentBuildings } from '../web/src/entities/pin/model/pins.ts'

test('場所カード：建物のカードは、しおりの順で前後の建物へ。しおりにない建物はそのあと、端で止まる', () => {
  const pins = [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'candidate' },
    { id: 'c', status: 'building' },
    { id: 'd', status: 'done' },
    { id: 'e', status: 'failed' },
  ]
  // しおりの順：d、a。c はまだしおりにない
  const orders = { d: 1, a: 2 }
  assert.deepEqual(adjacentBuildings(pins, 'd', orders), { prev: null, next: pins[0] })
  assert.deepEqual(adjacentBuildings(pins, 'a', orders), { prev: pins[3], next: pins[2] })
  assert.deepEqual(adjacentBuildings(pins, 'c', orders), { prev: pins[0], next: null })
})

test('場所カード：候補や失敗したピンは、建物どうしの前後を持たない', () => {
  const pins = [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'candidate' },
    { id: 'c', status: 'failed' },
  ]
  assert.deepEqual(adjacentBuildings(pins, 'b', {}), { prev: null, next: null })
  assert.deepEqual(adjacentBuildings(pins, 'c', {}), { prev: null, next: null })
  assert.deepEqual(adjacentBuildings(pins, 'a', {}), { prev: null, next: null })
})

// 場所カードのスワイプで選ぶ、同じ希望の前後の候補
import { adjacentCandidates } from '../web/src/entities/pin/model/pins.ts'

test('場所カード：前後の候補は、端で止まり一周しない', () => {
  const group = [
    { id: 'a', status: 'candidate' },
    { id: 'b', status: 'candidate' },
    { id: 'c', status: 'failed' },
  ]
  assert.deepEqual(adjacentCandidates(group, 'a'), { prev: null, next: group[1] })
  assert.deepEqual(adjacentCandidates(group, 'b'), { prev: group[0], next: group[2] })
  assert.deepEqual(adjacentCandidates(group, 'c'), { prev: group[1], next: null })
  assert.deepEqual(adjacentCandidates([{ id: 'a', status: 'candidate' }], 'a'), { prev: null, next: null })
})

test('場所カード：候補の前後は、建築中・建った建物を飛ばす。建物のカードは候補の前後を持たない', () => {
  const group = [
    { id: 'a', status: 'candidate' },
    { id: 'b', status: 'done' },
    { id: 'c', status: 'building' },
    { id: 'd', status: 'candidate' },
  ]
  assert.deepEqual(adjacentCandidates(group, 'a'), { prev: null, next: group[3] })
  assert.deepEqual(adjacentCandidates(group, 'd'), { prev: group[0], next: null })
  assert.deepEqual(adjacentCandidates(group, 'b'), { prev: null, next: null })
})


// 候補のピンを誰の地図に出すか（PR #49 のレビューの指摘で足した。前の検索も残す形は Takana の依頼、2026-11-22）
import { isPastCandidate, isViewWithin, isVisibleTo, PAST_PIN_RADIUS_KM, pinsInView } from '../web/src/entities/pin/model/pins.ts'

const viewer = (overrides = {}) => ({ uid: 'me', ...overrides })
const pinOf = (overrides = {}) => ({ uid: 'me', builtBy: null, status: 'candidate', wishId: 'w2', ...overrides })

test('ピンを出す人：工事中と完成の建物は、誰の地図にも出す', () => {
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'building' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'done' }), viewer()), true)
})

test('ピンを出す人：建築に失敗したピンは、希望を書いた人と建てようとした人にだけ出す', () => {
  assert.equal(isVisibleTo(pinOf({ status: 'failed' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'failed', builtBy: 'me' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'failed', builtBy: 'third' }), viewer()), false)
})

test('ピンを出す人：候補は、希望を書いた本人に、前の検索のぶんも消さずに出す', () => {
  assert.equal(isVisibleTo(pinOf(), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ wishId: 'w1' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other' }), viewer()), false)
})

test('前の検索の候補：いちばん新しい検索でない、まだ建てていない候補だけ', () => {
  assert.equal(isPastCandidate(pinOf({ wishId: 'w1' }), 'w2'), true)
  assert.equal(isPastCandidate(pinOf(), 'w2'), false)
  assert.equal(isPastCandidate(pinOf({ wishId: 'w1', status: 'done' }), 'w2'), false)
  assert.equal(isPastCandidate(pinOf({ wishId: 'w1', status: 'failed' }), 'w2'), false)
  assert.equal(isPastCandidate(pinOf({ wishId: '@filler', filler: { day: 1 } }), 'w2'), false)
})

test('前の検索の灰色のピン：見えている所がまるごと、その場所から 10 km の中に収まったら出す（かめの決定、2026-11-23）', () => {
  assert.equal(PAST_PIN_RADIUS_KM, 10)
  const soba = { lat: 36.2309, lng: 137.9644 } // 松本駅の近く
  const view = (north, south, west, east) => [
    { lat: north, lng: west },
    { lat: north, lng: east },
    { lat: south, lng: west },
    { lat: south, lng: east },
  ]
  // 390px のスマホで、そば屋を真ん中に寄った（幅約 9 km、高さ約 12 km）：出す
  assert.equal(isViewWithin(soba, view(36.28, 36.18, 137.92, 138.01)), true)
  // 少し引いた（幅約 17 km、高さ約 23 km）：まだ出さない
  assert.equal(isViewWithin(soba, view(36.33, 36.13, 137.87, 138.06)), false)
  // 美ヶ原と大王わさび農場のあいだだけが見える寄り方（幅約 34 km、高さ約 46 km）：真ん中に見えていても、まだ出さない
  assert.equal(isViewWithin(soba, view(36.47, 36.06, 137.83, 138.21)), false)
  // 寄っていても、その場所から遠くを見ているとき（軽井沢のあたり）：出さない
  assert.equal(isViewWithin(soba, view(36.4, 36.3, 138.55, 138.7)), false)
  // 見え方がまだないとき：出さない（呼ぶ側が絞らない）
  assert.equal(isViewWithin(soba, []), false)
})

test('地図に出すピン：前の検索の候補だけを、見えている所で絞る（選んでいるピン、いまの候補、建てたものは残す）', () => {
  const matsumoto = { lat: 36.2309, lng: 137.9644 }
  const karuizawa = { lat: 36.3427, lng: 138.6352 }
  // 松本駅のあたりまで寄った見え方
  const corners = [
    { lat: 36.28, lng: 137.92 },
    { lat: 36.28, lng: 138.01 },
    { lat: 36.18, lng: 137.92 },
    { lat: 36.18, lng: 138.01 },
  ]
  const pins = [
    { id: 'past-near', ...pinOf({ wishId: 'w1' }), location: matsumoto },
    { id: 'past-far', ...pinOf({ wishId: 'w1' }), location: karuizawa },
    { id: 'past-far-selected', ...pinOf({ wishId: 'w1' }), location: karuizawa },
    { id: 'now-far', ...pinOf({ wishId: 'w2' }), location: karuizawa },
    { id: 'done-far', ...pinOf({ wishId: 'w1', status: 'done' }), location: karuizawa },
    { id: 'failed-far', ...pinOf({ wishId: 'w1', status: 'failed' }), location: karuizawa },
    { id: 'filler-far', ...pinOf({ wishId: '@filler', filler: { day: 1 } }), location: karuizawa },
  ]
  const ids = (list) => list.map((pin) => pin.id)
  assert.deepEqual(ids(pinsInView(pins, { currentWishId: 'w2', selectedId: 'past-far-selected', corners })), [
    'past-near',
    'past-far-selected',
    'now-far',
    'done-far',
    'failed-far',
    'filler-far',
  ])
  // 見え方がまだないとき、いちばん新しい検索が分からないときは絞らない
  assert.equal(pinsInView(pins, { currentWishId: 'w2', selectedId: null, corners: null }).length, pins.length)
  assert.equal(pinsInView(pins, { currentWishId: undefined, selectedId: null, corners }).length, pins.length)
})

// 入力欄の例文を、地図で見ている地域に合わせる（Takana の依頼、2026-11-22）
import { PREFECTURE_HINTS } from '../web/src/features/add-wish/model/prefectureHints.ts'
import { pickHint } from '../web/src/features/add-wish/model/useRotatingHint.ts'
import { ALL_PREFECTURES, REGION_NAMES } from '../web/src/entities/trip/model/regions.ts'
import { focusAreaName, REGION_POINTS } from '../web/src/widgets/trip-map/lib/viewLabel.ts'

test('地域の例文：47 都道府県すべてに 4 つずつあり、地方の名前は旅の地方の名前とそろう', () => {
  assert.deepEqual(Object.keys(PREFECTURE_HINTS).sort(), [...ALL_PREFECTURES].sort())
  for (const hints of Object.values(PREFECTURE_HINTS)) assert.equal(new Set(hints).size, 4)
  assert.deepEqual(REGION_POINTS.map((point) => point.name).sort(), Object.values(REGION_NAMES).sort())
})

test('地域の例文：見ている広さで、日本全体（null）・地方・県を返す', () => {
  const around = (lat, lng, span) => ({ north: lat + span / 2, south: lat - span / 2, east: lng + span / 2, west: lng - span / 2 })
  assert.equal(focusAreaName(around(36, 138, 20)), null)
  assert.equal(focusAreaName(around(36.7, 138.3, 4)), '甲信越')
  assert.equal(focusAreaName(around(36.2, 138.0, 1)), '長野県')
  assert.equal(focusAreaName(around(26.4, 127.8, 1)), '沖縄県')
})

test('地域の例文：組が替わった直後でも新しい組から選び、同じ組ならいまと違う文を選ぶ', () => {
  const nagano = PREFECTURE_HINTS['長野県']
  assert.ok(nagano.includes(pickHint(nagano, 'おいしいご当地グルメが食べたい', () => 0.5)))
  for (const random of [0, 0.3, 0.6, 0.99]) assert.notEqual(pickHint(nagano, nagano[1], () => random), nagano[1])
})

// 場所を誰が出したかと、Google マップで確かめたかの断り書き（PlaceCard、しおりの場所の情報）
import { pinOriginNote, VERIFIED_NOTE } from '../web/src/entities/pin/model/origin.ts'

test('断り書き：Places で確かめた場所だけ「Google マップで確かめました」と出し、確かめていない Gemini の提案はそう書く', () => {
  assert.equal(pinOriginNote('Gemini', false), 'Geminiの提案です（実在の確認はしていません）')
  assert.equal(pinOriginNote('Gemini', true), `Geminiの提案です。${VERIFIED_NOTE}`)
  assert.equal(pinOriginNote(null, false), '見本の場所リストから出した候補です（AI の提案ではありません）')
  assert.equal(pinOriginNote(null, true, '場所'), `見本の場所リストから出した場所です（AI の提案ではありません）。${VERIFIED_NOTE}`)
  assert.ok(!pinOriginNote('Gemini', true).includes('確認はしていません'), '確かめたのに未確認と出す')
})

// 地図で見ているあたりの名前（「〜のあたりから探します」）。見ている広さで段を変える（#151）
import { describeBounds } from '../web/src/widgets/trip-map/lib/viewLabel.ts'

const around = (lat, lng, span) => ({ north: lat + span / 2, south: lat - span / 2, east: lng + span / 2, west: lng - span / 2 })

test('見ているあたりの名前：広さに合わせて、日本全体・地方・都道府県・市町村・駅や名所と細かくなる', () => {
  assert.equal(describeBounds(around(36.5, 138, 20)), '日本全体')
  assert.match(describeBounds(around(36.5, 138.3, 4)), /甲信越/)
  assert.equal(describeBounds(around(36.2, 138.0, 1)), '長野県')
  assert.equal(describeBounds(around(36.7, 137.86, 0.2)), '白馬村')
  assert.equal(describeBounds(around(36.698, 137.862, 0.02)), '白馬駅')
  assert.equal(describeBounds(around(35.681, 139.767, 0.02)), '東京駅')
  assert.equal(describeBounds(around(35.01, 135.77, 0.2)), '京都市')
})

test('見ているあたりの名前：県境の近くでは近くの市町村の県を出し、近くに名前がなければ一段広い名前にする', () => {
  // 軽井沢（長野県）は群馬県の真ん中のほうが近いが、近くの町から長野県と出す
  assert.equal(describeBounds(around(36.35, 138.6, 1)), '長野県')
  // 山の中で、近くに駅も町もないほど寄せたら、県の名前
  assert.equal(describeBounds(around(36.0, 137.5, 0.02)), '長野県')
})

import { readReference } from '../web/src/entities/model3d/model/reference.ts'

test('模型の参考の説明：https の出典がそろうときだけ読み、説明の文は古い記録や長い文でも崩れない', () => {
  const base = { url: 'https://ja.wikipedia.org/wiki/x', license: 'https://creativecommons.org/licenses/by-sa/3.0/' }
  assert.deepEqual(readReference({ ...base, text: ' 善光寺は寺院。 ' }), { ...base, text: '善光寺は寺院。' })
  assert.deepEqual(readReference(base), { ...base, text: '' }, '説明のない古い記録')
  assert.equal(readReference({ ...base, text: 3 }).text, '')
  assert.equal(readReference({ ...base, text: 'あ'.repeat(900) }).text.length, 401)
  for (const broken of [null, undefined, {}, { ...base, url: 'http://x' }, { ...base, license: 'javascript:alert(1)' }]) assert.equal(readReference(broken), undefined)
})

import { MAX_REMEMBERED, remember, reviewsState } from '../web/src/features/place-reviews/model/reviewsMemory.ts'
import { reviewsAsk } from '../web/src/features/place-reviews/model/ask.ts'

test('口コミの聞き方：確かめた場所は place_id、確かめていない候補と建築に失敗したピンは candidate、ほかは聞かない', () => {
  assert.equal(reviewsAsk({ placeId: 'ChIJ1', status: 'done' }), 'ChIJ1')
  assert.equal(reviewsAsk({ placeId: 'ChIJ1', status: 'candidate' }), 'ChIJ1')
  assert.equal(reviewsAsk({ placeId: null, status: 'candidate' }), 'candidate')
  assert.equal(reviewsAsk({ placeId: null, status: 'failed' }), 'candidate')
  assert.equal(reviewsAsk({ placeId: null, status: 'building' }), null)
  assert.equal(reviewsAsk({ placeId: null, status: 'done' }), null)
  // 候補のときと、確かめたあとで聞き方が変わるので、覚えた答えは分かれる（usePlaceReviews のキーに入る）
  assert.notEqual(reviewsAsk({ placeId: null, status: 'candidate' }), reviewsAsk({ placeId: 'ChIJ1', status: 'done' }))
})

test('口コミの言語：口コミを聞くときに、表示言語（appLanguage）を関数に送る', () => {
  const source = readFileSync(new URL('../web/src/features/place-reviews/api/placeReviews.ts', import.meta.url), 'utf8')
  assert.match(source, /'placeReviews'\)\(\{ tripId, pinId, language: appLanguage \}\)/, '英語の表示でも日本語の口コミを聞いてしまう')
})

test('口コミの答え：出せた答えだけ覚え、届いた答えはその場で出し、出せなかった場所はあとで聞き直せる', () => {
  const memory = new Map()
  const found = { reviews: [{ author: 'a', text: 'よかった' }], placeUri: null }
  assert.deepEqual(reviewsState(memory, 'k', null, false, true), { status: 'idle' }, '閉じているのに聞いた')
  assert.deepEqual(reviewsState(memory, 'k', null, true, false), { status: 'idle' }, '聞いてよくない場所（確かめていない建物など）')
  assert.deepEqual(reviewsState(memory, 'k', null, true, true), { status: 'loading' })
  // 届いた答えはその場で出る（覚えた Map だけに頼らない）
  assert.deepEqual(reviewsState(memory, 'k', { key: 'k', data: found }, true, true), { status: 'ready', data: found })
  // 出せなかった答えは覚えない。今の表示は none、閉じて答えを外したら loading（聞き直す）
  remember(memory, 'k', null)
  assert.equal(memory.has('k'), false)
  assert.deepEqual(reviewsState(memory, 'k', { key: 'k', data: null }, true, true), { status: 'none' })
  assert.deepEqual(reviewsState(memory, 'k', null, true, true), { status: 'loading' })
  // 出せた答えは覚え、閉じて広げ直しても ready のまま
  remember(memory, 'k', found)
  assert.deepEqual(reviewsState(memory, 'k', null, true, true), { status: 'ready', data: found })
  // 別の場所の答えは使わない
  assert.deepEqual(reviewsState(memory, 'other', { key: 'k', data: found }, true, true), { status: 'loading' })
  for (let i = 0; i < MAX_REMEMBERED + 5; i++) remember(memory, `p${i}`, found)
  assert.equal(memory.size, MAX_REMEMBERED)
  assert.equal(memory.has('k'), false, '古いものから捨てていない')
})

import { roadLinePoints } from '../web/src/entities/route/model/routes.ts'

test('しおりの線：道の形がある区間はそれに沿わせ、ない区間はまっすぐ。区間の両端は場所の位置でつなぐ', () => {
  const at = (lat) => ({ lat, lng: lat })
  const stops = [{ id: 'a', location: at(1) }, { id: 'b', location: at(2) }, { id: 'c', location: at(3) }]
  assert.deepEqual(roadLinePoints(stops), [at(1), at(2), at(3)], '道の形がないのに曲げた')
  const legPaths = [{ key: 'a>b', points: [at(1.01), at(1.3), at(1.6), at(1.99)] }]
  assert.deepEqual(roadLinePoints(stops, legPaths), [at(1), at(1.3), at(1.6), at(2), at(3)])
  // 出発地からの区間（@origin）は線に入れない（線は場所どうしを結ぶ）
  assert.deepEqual(roadLinePoints(stops, [{ key: '@origin>a', points: [at(0), at(0.5), at(1)] }]), [at(1), at(2), at(3)])
})

test('旅の再生：車は区間の道に沿って進み、端では出発と到着の場所にいる', () => {
  const leg = makeLeg([
    { lat: 35, lng: 139 },
    { lat: 35, lng: 139.01 },
    { lat: 35.01, lng: 139.01 },
  ])
  assert.ok(leg.length > 1500 && leg.length < 2100)
  assert.deepEqual(placeAlong(leg, 0).point, { lat: 35, lng: 139 })
  assert.deepEqual(placeAlong(leg, 1).point, { lat: 35.01, lng: 139.01 })
  // 半分のところは、1 つ目の曲がり角のあたり
  const half = placeAlong(leg, 0.5).point
  assert.ok(Math.abs(half.lng - 139.01) < 0.001 && Math.abs(half.lat - 35) < 0.001)
  // 向きは、そのあたりで走っている道の向き（北が 0、東が 90）。曲がり角の先では北へ向く
  assert.ok(Math.abs(placeAlong(leg, 0.2).heading - 90) < 1)
  assert.ok(placeAlong(leg, 0.9).heading < 1 || placeAlong(leg, 0.9).heading > 359)
  assert.ok(Math.abs(placeAlong(makeLeg([{ lat: 35, lng: 139 }, { lat: 35, lng: 138 }]), 0.5).heading - 270) < 1)
  assert.ok(Math.abs(bearing({ lat: 35, lng: 139 }, { lat: 34, lng: 139 }) - 180) < 1e-9)
})

test('旅の再生：走る時間は、近い区間も遠い区間も決めた範囲に収まり、動きは端でゆっくり', () => {
  assert.equal(driveMs(100), DRIVE_MIN_MS)
  assert.equal(driveMs(500_000), DRIVE_MAX_MS)
  assert.ok(driveMs(20_000) > DRIVE_MIN_MS && driveMs(20_000) < DRIVE_MAX_MS)
  assert.equal(easeInOut(0), 0)
  assert.equal(easeInOut(1), 1)
  assert.equal(easeInOut(0.5), 0.5)
  assert.ok(easeInOut(0.1) < 0.1)
})

test('旅の再生：建物の真ん中ではなく、縁から走り出して縁で止まる。短い区間は真ん中まで', () => {
  const leg = makeLeg([
    { lat: 35, lng: 139 },
    { lat: 35, lng: 139.1 },
  ])
  const trim = 1000
  const start = placeAlong(leg, 0, trim).point
  const end = placeAlong(leg, 1, trim).point
  // 1000m 詰めると、経度でおよそ 0.011 度ずつ内側
  assert.ok(Math.abs(start.lng - 139.011) < 0.001 && Math.abs(end.lng - 139.089) < 0.001)
  // 区間より長く詰めても、真ん中で止まる
  assert.ok(Math.abs(placeAlong(leg, 0, 50_000).point.lng - 139.05) < 1e-6)
})

test('旅の再生：寄り具合は、建物と建物のあいだが決めた長さ（px）に見える度合い。近い区間ほど寄る', () => {
  // 赤道の上で経度 1 度（約 111km）。拡大の度合い z では 1px が 156543 / 2^z m
  const far = makeLeg([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }])
  const zoom = legZoom(far, 400)
  assert.ok(Math.abs((156543.03392 / 2 ** zoom) * 400 - far.length) < 1)
  // 10 倍近いと、度合いはおよそ log2(10) だけ大きい
  const near = makeLeg([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }])
  assert.ok(Math.abs(legZoom(near, 400) - zoom - Math.log2(10)) < 0.01)
  // 長さのない区間は決めない
  assert.equal(legZoom(makeLeg([{ lat: 0, lng: 0 }]), 400), null)
})

import { project, spotZoom, viewBetween, viewGap } from '../web/src/widgets/trip-map/lib/mercator.ts'
import { ORIGIN_SPOT, spotNeighbors, spotOrder } from '../web/src/pages/trip-map/model/spots.ts'
import { originLocation } from '../web/src/entities/trip/model/originPlaces.ts'

// しおりの場所の情報の寄り具合（#224）。スマホ（390×844）で、上の帯とシートの半分ほどを空けたとき
const SCREEN = { width: 390, height: 844 }
const PLACE_PADDING = { top: 178, right: 76, bottom: 466, left: 44 }
const RULE = { size: 126, gap: 1.1, min: 9, max: 15, alone: 11, keep: 0.5 }
const SPOT = { lat: 36.2, lng: 137.9 }
/** SPOT から北へ km だけ離れた場所 */
const north = (km) => ({ lat: SPOT.lat + km / 111.2, lng: SPOT.lng })
/** SPOT から東へ km だけ離れた場所 */
const east = (km) => ({ lat: SPOT.lat, lng: SPOT.lng + km / (111.2 * Math.cos((SPOT.lat * Math.PI) / 180)) })
/** 拡大の度合い zoom で SPOT を真ん中にしたとき、other が画面の上で SPOT からどれだけ離れているか（px） */
const screenGap = (other, zoom) => {
  const a = project({ center: SPOT, zoom }, SCREEN, SPOT)
  const b = project({ center: SPOT, zoom }, SCREEN, other)
  return { dx: Math.abs(b.x - a.x), dy: Math.abs(b.y - a.y), distance: Math.hypot(b.x - a.x, b.y - a.y) }
}

test('場所の情報の寄り具合：ほかに建物がなければ決めた値（11）', () => {
  assert.equal(spotZoom(SPOT, [], SCREEN, PLACE_PADDING, RULE), 11)
  // 同じ場所に重なっている建物は、まわりの建物に数えない
  assert.equal(spotZoom(SPOT, [SPOT], SCREEN, PLACE_PADDING, RULE), 11)
})

test('場所の情報の寄り具合：密集していれば寄って、となりの建物と重ならない間隔にする（上限 15）', () => {
  // 2km 先：重ならない間隔（126 × 1.1 px）まで寄る
  const zoom = spotZoom(SPOT, [east(2), north(6)], SCREEN, PLACE_PADDING, RULE)
  assert.ok(zoom > 11 && zoom <= 15, `zoom ${zoom}`)
  assert.ok(screenGap(east(2), zoom).distance >= 126 * 1.1)
  // 200m 先：どれだけ寄っても上限の 15 まで
  assert.equal(spotZoom(SPOT, [north(0.2)], SCREEN, PLACE_PADDING, RULE), 15)
})

test('場所の情報の寄り具合：点在していれば引いて、いちばん近い建物も見える所に入れる（下限 9）', () => {
  // シートを下げて地図が広いとき：いちばん近い建物（北に 25km）が、真ん中から見える所の端まで（上下は (844 - 178 - 200) / 2 px）に入る
  const lowered = { ...PLACE_PADDING, bottom: 200 }
  const near = north(25)
  const zoom = spotZoom(SPOT, [near, east(60)], SCREEN, lowered, RULE)
  assert.ok(zoom >= 9 && zoom < 11, `zoom ${zoom}`)
  assert.ok(screenGap(near, zoom).dy <= (844 - 178 - 200) / 2)
  assert.ok(screenGap(near, zoom).distance >= 126 * 1.1)
  // 0.25 きざみ
  assert.equal(zoom * 4, Math.round(zoom * 4))
})

test('場所の情報の寄り具合：見える所が狭くて、重ならない間隔と画面に入れるのを両方は満たせないときは、重ならないほうを選ぶ', () => {
  // シートが半分ほど出ているとき、見える所の左右の半分（135px）は、重ならない間隔（126 × 1.1 px）より狭い
  const zoom = spotZoom(SPOT, [east(25)], SCREEN, PLACE_PADDING, RULE)
  assert.ok(zoom >= 9 && zoom < 11, `zoom ${zoom}`)
  assert.ok(screenGap(east(25), zoom).distance >= 126 * 1.1)
})

test('場所の情報の寄り具合：となりがとても遠くても、下限（9）より引かない', () => {
  assert.equal(spotZoom(SPOT, [north(300)], SCREEN, PLACE_PADDING, RULE), 9)
})

test('場所の情報の寄り具合：混んでいるほど寄る', () => {
  const zooms = [0.5, 2, 8, 30].map((km) => spotZoom(SPOT, [east(km)], SCREEN, PLACE_PADDING, RULE))
  for (let index = 1; index < zooms.length; index += 1) assert.ok(zooms[index] <= zooms[index - 1], zooms.join(', '))
  assert.ok(zooms[0] > zooms[3])
})

test('場所の情報の寄り具合：今の拡大の度合いとの差が 0.5 以内なら、今のままにする（寄ったり引いたりを繰り返さない）', () => {
  const target = spotZoom(SPOT, [east(8)], SCREEN, PLACE_PADDING, RULE)
  assert.equal(spotZoom(SPOT, [east(8)], SCREEN, PLACE_PADDING, RULE, target + 0.4), target + 0.4)
  assert.equal(spotZoom(SPOT, [east(8)], SCREEN, PLACE_PADDING, RULE, target - 0.5), target - 0.5)
  assert.equal(spotZoom(SPOT, [east(8)], SCREEN, PLACE_PADDING, RULE, target + 1), target)
  // 今のままにするときも、上限と下限の外には出さない
  assert.equal(spotZoom(SPOT, [north(0.2)], SCREEN, PLACE_PADDING, RULE, 15.3), 15)
})

test('地図をなめらかに動かす途中の見え方：始めと終わりは、元と行き先の見え方', () => {
  const from = { center: { lat: 36, lng: 137 }, zoom: 9 }
  const to = { center: { lat: 36.3, lng: 137.4 }, zoom: 12 }
  const start = viewBetween(from, to, 0)
  const end = viewBetween(from, to, 1)
  assert.ok(Math.abs(start.center.lat - 36) < 1e-9 && Math.abs(start.center.lng - 137) < 1e-9 && start.zoom === 9)
  assert.ok(Math.abs(end.center.lat - 36.3) < 1e-9 && Math.abs(end.center.lng - 137.4) < 1e-9 && end.zoom === 12)
  assert.equal(viewBetween(from, to, 0.5).zoom, 10.5)
  // 途中も、行き先の真ん中は画面の上で元の位置から真ん中へまっすぐ近づく（半分のときは、ずれも半分）
  const size = { width: 390, height: 844 }
  const before = project(from, size, to.center)
  const middle = project(viewBetween(from, to, 0.5), size, to.center)
  assert.ok(Math.abs(middle.x - 195 - (before.x - 195) / 2) < 0.5 && Math.abs(middle.y - 422 - (before.y - 422) / 2) < 0.5)
  // 2 つの見え方の離れ具合は、引いているほうの拡大の度合いで測る
  assert.ok(viewGap(from, to) > 0 && Math.abs(viewGap(from, to) - viewGap(to, from)) < 1e-9)
})

test('しおりの場所の情報の並び：集合場所が先頭で、そのあとしおりの順（#226）', () => {
  const order = spotOrder(['a', 'b', 'c'])
  assert.deepEqual(order, [ORIGIN_SPOT, 'a', 'b', 'c'])
  // 集合場所の次は 1 つ目の場所、1 つ目の場所の前は集合場所。端では止まる（一周しない）
  assert.deepEqual(spotNeighbors(order, ORIGIN_SPOT), { prev: null, next: 'a' })
  assert.deepEqual(spotNeighbors(order, 'a'), { prev: ORIGIN_SPOT, next: 'b' })
  assert.deepEqual(spotNeighbors(order, 'c'), { prev: 'b', next: null })
  // 並びにない場所は null
  assert.equal(spotNeighbors(order, 'x'), null)
})

test('しおりの場所の情報の並び：建物が 0 か 1 のときも崩れない', () => {
  assert.deepEqual(spotNeighbors(spotOrder([]), ORIGIN_SPOT), { prev: null, next: null })
  assert.deepEqual(spotNeighbors(spotOrder(['a']), 'a'), { prev: ORIGIN_SPOT, next: null })
})

test('集合場所の位置：出発地の名前からおよその位置を引く。表にない名前は null（Functions と同じ表）', () => {
  assert.deepEqual(originLocation('東京駅'), { lat: 35.68, lng: 139.77 })
  assert.deepEqual(originLocation('新大阪駅'), { lat: 34.73, lng: 135.5 })
  assert.equal(originLocation('自宅'), null)
})

import { readFileSync } from 'node:fs'
import { withOriginStop } from '../web/src/entities/route/model/routes.ts'
import { legModeOf } from '../web/src/entities/route/model/legs.ts'
import { originLocation as functionsOriginLocation } from '../functions/src/domain/originPlaces.ts'

test('しおりの行：出発の行がない旅には、先頭に時刻なしの集合場所の行を足す（#226）', () => {
  const stop = (pinId, day = 1) => ({ day, time: '09:00', pinId, name: pinId ?? '東京駅 出発', stayMinutes: 60, moveMinutesToNext: null })
  // 出発の行があれば、そのまま
  const withOrigin = [stop(null), stop('a')]
  assert.equal(withOriginStop(withOrigin, '東京駅'), withOrigin)
  // なければ先頭に足す（時刻なし、ピンなし）
  const added = withOriginStop([stop('a'), stop('b', 2)], '自宅')
  assert.equal(added.length, 3)
  assert.deepEqual(added[0], { day: 1, time: '', pinId: null, name: '自宅 出発', stayMinutes: 0, moveMinutesToNext: null })
  // 行がなければ足さない
  assert.deepEqual(withOriginStop([], '自宅'), [])
})

test('集合場所の表：画面の表は、Functions の表とまったく同じ', () => {
  const table = (file) => {
    // Windows の作業ツリーでは改行が CRLF のことがあるので、そろえてから比べる
    const text = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    return text.slice(text.indexOf('const PLACES'), text.indexOf('\n]\n', text.indexOf('const PLACES')))
  }
  const web = table('../web/src/entities/trip/model/originPlaces.ts')
  assert.ok(web.length > 100)
  assert.equal(web, table('../functions/src/domain/originPlaces.ts'))
  for (const name of ['東京駅', '新大阪', '津駅', '那覇空港', '自宅']) assert.deepEqual(originLocation(name), functionsOriginLocation(name))
})

test('旅の再生：出発地の位置が分かるときは、出発地から 1 つ目の場所へ走って着く', () => {
  const road = (length) => ({ length })
  const originRoad = road(100000)
  const first = road(5000)
  const steps = tourSteps(2, [first], originRoad, () => road(0), false)
  assert.deepEqual(steps.map((step) => [step.kind, step.index]), [['drive', 0], ['arrive', 0], ['drive', 1], ['arrive', 1]])
  assert.equal(steps[0].leg, originRoad, '最初は出発地からの区間を走る')
  assert.equal(steps[0].ms, driveMs(100000))
  assert.equal(steps[1].leg, originRoad, '1 つ目の場所では、出発地からの区間の終わりに止まる')
  assert.equal(steps[1].progress, 1)
  assert.equal(steps[1].ms, ARRIVE_MS)
})

test('旅の途中再生：指定した場所の到着から、元の番号のまま最後まで進む', () => {
  const roads = [{ length: 100 }, { length: 200 }, { length: 300 }]
  const origin = { length: 1000 }
  const steps = tourSteps(4, roads, origin, () => ({ length: 0 }), false, 2)
  assert.deepEqual(steps.map(({ kind, index }) => [kind, index]), [['arrive', 2], ['drive', 3], ['arrive', 3]])
  assert.equal(steps[0].leg, roads[1])
  assert.equal(steps[0].progress, 1, '表示中の場所に着いた状態から始まる')
  assert.equal(steps[1].leg, roads[2], '次の場所への道を走る')
  assert.equal(steps[0].ms, ARRIVE_MS)
  const first = tourSteps(4, roads, origin, () => ({ length: 0 }), false, 0)
  assert.equal(first[0].kind, 'arrive', '最初の場所を指定しても、集合場所から走り直さない')
  const last = tourSteps(4, roads, origin, () => ({ length: 0 }), false, 3)
  assert.deepEqual(last.map(({ kind, index }) => [kind, index]), [['arrive', 3]], '最後の場所からは到着だけで終わる')
  const reduced = tourSteps(4, roads, origin, () => ({ length: 0 }), true, 2)
  assert.equal(reduced[1].ms, 0, '動きを減らす設定でも開始位置は変わらない')
  for (const invalid of [-1, 4, 0.5, NaN]) assert.deepEqual(tourSteps(4, roads, origin, () => ({ length: 0 }), false, invalid), [])
  assert.deepEqual(tourSteps(1, [], null, () => ({ length: 0 }), false, 0).map(({ kind, index }) => [kind, index]), [['arrive', 0]])
})

test('旅の再生：出発地の位置が分からないときは、1 つ目の場所から始まる', () => {
  const road = (length) => ({ length })
  const first = road(5000)
  const steps = tourSteps(2, [first], null, () => road(0), false)
  assert.deepEqual(steps.map((step) => [step.kind, step.index]), [['arrive', 0], ['drive', 1], ['arrive', 1]])
  assert.equal(steps[0].leg, first, '1 つ目の場所は、出ていく区間の始まり')
  assert.equal(steps[0].progress, 0)
})

test('旅の再生：場所が 1 つでも、出発地があれば走って着く。動きを減らす設定では走らない', () => {
  const road = (length) => ({ length })
  const originRoad = road(100000)
  assert.deepEqual(tourSteps(1, [], originRoad, () => road(0), false).map((step) => step.kind), ['drive', 'arrive'])
  assert.equal(tourSteps(1, [], originRoad, () => road(0), true)[0].ms, 0)
  assert.deepEqual(tourSteps(0, [], originRoad, () => road(0), false), [], '場所がなければ走らない')
})

test('旅の再生：区間の手段で走る乗り物が決まる（電車・バスは電車、徒歩は人、飛行機は飛行機）', () => {
  assert.equal(tourVehicleOf('transit'), 'train')
  assert.equal(tourVehicleOf('walk'), 'walker')
  assert.equal(tourVehicleOf('car'), 'car')
  assert.equal(tourVehicleOf('plane'), 'plane')
})

test('しおりの区間の手段：選んだ手段があればそれ、なければ区間の既定（遠い区間は飛行機、ほかは旅全体の手段）', () => {
  const places = { a: { lat: 35.68, lng: 139.76 }, b: { lat: 35.7, lng: 139.8 }, far: { lat: 43.06, lng: 141.35 }, '@origin': { lat: 35.66, lng: 139.7 } }
  const locate = (id) => places[id]
  assert.equal(legModeOf(undefined, 'a', 'b', locate, 'transit'), 'transit')
  assert.equal(legModeOf({ 'a>b': 'walk' }, 'a', 'b', locate, 'transit'), 'walk')
  assert.equal(legModeOf({ 'b>a': 'walk' }, 'a', 'b', locate, 'car'), 'car', 'ほかの区間の選びは使わない')
  assert.equal(legModeOf({}, 'a', 'far', locate, 'car'), 'plane', '東京から札幌は最初から飛行機')
  assert.equal(legModeOf({ 'a>far': 'transit' }, 'a', 'far', locate, 'car'), 'transit')
  assert.equal(legModeOf({ '@origin>a': 'walk' }, '@origin', 'a', locate, 'transit'), 'walk', '集合場所からの区間も同じキーの形')
  assert.equal(legModeOf(undefined, 'a', 'unknown', locate, 'transit'), 'transit', '位置が分からなければ旅全体の手段')
})

test('旅の再生：再生の中の時間から、いまの段と、その段に入ってからの時間が決まる（一時停止の続きは、同じ時間から）', () => {
  const steps = [{ ms: 1000 }, { ms: 0 }, { ms: 500 }]
  assert.deepEqual(tourStepAt(steps, 0), { step: steps[0], elapsed: 0 })
  assert.deepEqual(tourStepAt(steps, 999), { step: steps[0], elapsed: 999 })
  assert.deepEqual(tourStepAt(steps, 1000), { step: steps[2], elapsed: 0 }, '長さ 0 の段（動きを減らす設定の走る段）は飛ばす')
  assert.deepEqual(tourStepAt(steps, 1400), { step: steps[2], elapsed: 400 })
  assert.equal(tourStepAt(steps, 1500), null, '最後の段を過ぎたら終わり')
  assert.equal(tourStepAt([], 0), null)
})

test('旅の再生：画面を押すと、移動を飛ばして次に着く所の始まりへ移る', () => {
  // 集合場所から走る → 1 つ目に着く → 空港まで走る → 空港に着く → 飛ぶ → 2 つ目に着く
  const steps = [
    { kind: 'drive', ms: 3000 },
    { kind: 'arrive', ms: 4500 },
    { kind: 'drive', ms: 2000 },
    { kind: 'arrive', ms: 4500, via: true },
    { kind: 'drive', ms: 5000 },
    { kind: 'arrive', ms: 4500 },
  ]
  assert.equal(nextArrivalAt(steps, 0), 3000, '走っているあいだは、その区間の終わり（1 つ目に着く）')
  assert.equal(nextArrivalAt(steps, 2999), 3000)
  assert.equal(nextArrivalAt(steps, 3000), 9500, '着いて止まっているあいだは、次に着く所（途中の空港）まで')
  assert.equal(nextArrivalAt(steps, 8000), 9500)
  assert.equal(nextArrivalAt(steps, 12000), 19000, '空港から飛ぶ区間も飛ばせる')
  assert.equal(tourStepAt(steps, nextArrivalAt(steps, 15000)).step, steps[5], '飛ばした先は着いた段の始まり')
  assert.equal(nextArrivalAt(steps, 20000), null, '最後の場所で止まっているときは飛ばさない')
  assert.equal(nextArrivalAt(steps, 99999), null, '再生が終わっていたら飛ばさない')
  assert.equal(nextArrivalAt([{ kind: 'drive', ms: 0 }, { kind: 'arrive', ms: 4500 }, { kind: 'drive', ms: 0 }, { kind: 'arrive', ms: 4500 }], 100), 4500, '動きを減らす設定（走る段が 0 ms）でも次の場所へ')
})

test('旅の再生：速さは ×1 → ×2 → ×4 と切り替わり、×4 の次は ×1 に戻る', () => {
  assert.deepEqual([...TOUR_SPEEDS], [1, 2, 4])
  assert.equal(nextTourSpeed(1), 2)
  assert.equal(nextTourSpeed(2), 4)
  assert.equal(nextTourSpeed(4), 1)
})

import { placeReviewsAsk } from '../web/src/pages/trip-map/model/shiori.ts'

test('しおりの写真：place_id のない建った場所（用意した部品の模型）も、名前で聞く（#279）', () => {
  assert.equal(placeReviewsAsk('ChIJ1'), 'ChIJ1')
  assert.equal(placeReviewsAsk(null), 'by-name')
})

test('アプリ全体の合言葉：本番では、合言葉の記録がないと守り、あれば開く', async () => {
  const { appLockState } = await import('../web/src/pages/app-lock/model/appLock.ts')
  const production = { local: false, forced: false }
  assert.equal(appLockState({ ...production, loading: true, unlocked: false }), 'checking')
  assert.equal(appLockState({ ...production, loading: false, unlocked: false }), 'locked')
  assert.equal(appLockState({ ...production, loading: false, unlocked: true }), 'open')
})

test('アプリ全体の合言葉：手元では守らない。?lock を付けて開いたときだけ守る', async () => {
  const { appLockState } = await import('../web/src/pages/app-lock/model/appLock.ts')
  assert.equal(appLockState({ local: true, forced: false, loading: true, unlocked: false }), 'open')
  assert.equal(appLockState({ local: true, forced: false, loading: false, unlocked: false }), 'open')
  assert.equal(appLockState({ local: true, forced: true, loading: false, unlocked: false }), 'locked')
  assert.equal(appLockState({ local: true, forced: true, loading: false, unlocked: true }), 'open')
})

test('取っ手の動かし始めの向き：縦なら上げ下げ、横なら前後の場所へのスワイプに任せる', () => {
  assert.equal(dragAxis(2, 3), null, '押しただけなのに向きを決めた')
  assert.equal(dragAxis(1, 10), 'vertical')
  assert.equal(dragAxis(-2, -10), 'vertical')
  assert.equal(dragAxis(10, 2), 'horizontal')
  assert.equal(dragAxis(-10, 4), 'horizontal')
  assert.equal(dragAxis(7, 7), 'vertical', '同じなら縦')
})

test('場所カードの畳む枠は、指で動かした量に合わせて開き具合が変わる', () => {
  assert.equal(foldOpenness('full', 0, 200, 1), 1)
  assert.equal(foldOpenness('full', 100, 200, 1), 0.5)
  assert.equal(foldOpenness('full', 200, 200, 1), 0)
  assert.equal(foldOpenness('peek', 0, 200, 1), 0)
  assert.equal(foldOpenness('peek', -50, 200, 1), 0.25)
  assert.equal(foldOpenness('peek', -200, 200, 1), 1)
  // 中身が切れていて半分しか見えていなかった：動かし始めは見えていた半分のまま
  assert.equal(foldOpenness('full', 0, 200, 0.5), 0.5)
  assert.equal(foldOpenness('full', 100, 200, 0.5), 0.25)
  assert.equal(foldOpenness('peek', 0, 0, 1), 0)
})

test('区間の両端にある建物のうち、いちばん大きいものの大きさで車を止める。端に建物がなければ null', () => {
  const leg = makeLeg([
    { lat: 35.68, lng: 139.76 },
    { lat: 35.69, lng: 139.77 },
  ])
  // 1px あたり 2m（拡大の度合い 16 くらい）。24px = 48m 以内なら端の建物
  const buildings = [
    { location: { lat: 35.6801, lng: 139.76 }, size: 120 },
    { location: { lat: 35.69, lng: 139.7701 }, size: 180 },
    { location: { lat: 35.685, lng: 139.765 }, size: 300 },
  ]
  assert.equal(legEndSize(leg, buildings, 2), 180)
  assert.equal(legEndSize(leg, buildings.slice(2), 2), null)
  assert.equal(legEndSize(makeLeg([]), buildings, 2), null)
})

test('旅の合言葉：小文字、全角、空白、ハイフンが混ざっていても、同じ合言葉にそろえる', () => {
  assert.equal(normalizeJoinCode('k7m2px'), 'K7M2PX')
  assert.equal(normalizeJoinCode(' K7M-2PX '), 'K7M2PX')
  assert.equal(normalizeJoinCode('Ｋ７Ｍ　２ＰＸ'), 'K7M2PX')
  assert.equal(normalizeJoinCode('K7M2P'), null)
  // 0・O・1・I は使わない文字
  assert.equal(normalizeJoinCode('K7M2P0'), null)
})

test('旅の合言葉：空のときと形が違うときは、理由を出す', () => {
  assert.equal(joinCodeProblem('  '), '旅の合言葉を入れてください。')
  assert.match(joinCodeProblem('ABC'), /英数字 6 文字/)
  assert.equal(joinCodeProblem('k7m 2px'), null)
})

test('Google アカウントとの連携：できなかった理由が分からなくても、決まった文を出す（例外にしない）', () => {
  const fallback = '連携できませんでした。電波のよいところで、もう一度押してください。'
  assert.equal(linkProblem(null), fallback)
  assert.equal(linkProblem(undefined), fallback)
  assert.equal(linkProblem('auth/network-request-failed'), fallback)
  assert.equal(linkProblem('auth/operation-not-allowed'), 'Google アカウントとの連携はまだ使えません。')
  assert.match(linkProblem('auth/popup-blocked'), /ポップアップ/)
  // 投げられたものが null や文字列でも、コードなしとして扱う
  assert.equal(errorCode(null), null)
  assert.equal(errorCode(undefined), null)
  assert.equal(errorCode('boom'), null)
  assert.equal(errorCode({ code: 42 }), null)
  assert.equal(errorCode({ code: 'auth/popup-blocked' }), 'auth/popup-blocked')
})

test('Google アカウントとの連携：ログインの画面から戻ったあとに知らせる結果を、覚えて読み戻す', () => {
  assert.deepEqual(parseLinkOutcome(encodeLinkOutcome({ kind: 'linked' })), { kind: 'linked' })
  assert.deepEqual(parseLinkOutcome(encodeLinkOutcome({ kind: 'switched' })), { kind: 'switched' })
  // 失敗の理由が分からないとき（null のエラーなど）も、失敗として読み戻せて、画面の文にできる
  for (const code of [undefined, null, 42]) {
    const outcome = parseLinkOutcome(encodeLinkOutcome({ kind: 'failed', code }))
    assert.deepEqual(outcome, { kind: 'failed', code: null })
    assert.equal(typeof linkProblem(outcome.code), 'string')
  }
  assert.deepEqual(parseLinkOutcome(encodeLinkOutcome({ kind: 'failed', code: 'auth/operation-not-allowed' })), {
    kind: 'failed',
    code: 'auth/operation-not-allowed',
  })
  // 前の形の値（failed だけ）と、知らない値
  assert.deepEqual(parseLinkOutcome('failed'), { kind: 'failed', code: null })
  assert.equal(parseLinkOutcome('something-else'), null)
  assert.equal(parseLinkOutcome(null), null)
})

import { untilReset, usageView } from '../web/src/widgets/usage-panel/model/usageRows.ts'

const NOW = new Date('2026-11-16T01:36:30Z') // 日本時間 10:36:30、太平洋標準時 11-15 17:36:30

test('usage-panel：「何回中何回」と棒の長さ・色。8 割から注意、上限で赤', () => {
  assert.deepEqual(usageView({ key: 'routes', period: 'day', used: 12, max: 30 }, NOW), {
    key: 'routes', name: 'Routes', period: '今日', count: '12 / 30', ratio: 0.4, tone: 'ok', reset: 'あと 6h 24m で 0 に戻る',
  })
  assert.equal(usageView({ key: 'routes', period: 'day', used: 24, max: 30 }, NOW).tone, 'warn')
  const full = usageView({ key: 'mapsLoad', period: 'day', used: 310, max: 300 }, NOW)
  assert.equal(full.tone, 'full')
  assert.equal(full.ratio, 1)
  assert.equal(full.count, '310 / 300')
  assert.equal(usageView({ key: 'flash', period: 'total', used: 1200, max: 100000 }, NOW).count, '1,200 / 100,000')
  assert.equal(usageView({ key: 'flash', period: 'total', used: 1, max: 300 }, NOW).reset, null)
  assert.equal(usageView({ key: 'placesPhoto', period: 'day', used: 0, max: 0 }, NOW).count, '使わない設定')
  assert.equal(usageView({ key: 'placesPhoto', period: 'day', used: 0, max: 0 }, NOW).reset, null)
  assert.equal(usageView({ key: 'argonTotal', period: 'total', used: null, max: 300 }, NOW).count, '? / 300')
})

test('usage-panel：0 に戻るまでの時間。Maps 系は太平洋時間、Argon は日本時間の 0 時まで。分は切り上げ', () => {
  assert.equal(untilReset(NOW, 'America/Los_Angeles'), 'あと 6h 24m')
  assert.equal(usageView({ key: 'argonDay', period: 'day', used: 3, max: 20 }, NOW).reset, 'あと 13h 24m で 0 に戻る')
  // 0 時ちょうどは、次の 0 時まで 24h
  assert.equal(untilReset(new Date('2026-11-15T15:00:00Z'), 'Asia/Tokyo'), 'あと 24h 0m')
  // 残り 1 分未満は 1m
  assert.equal(untilReset(new Date('2026-11-15T14:59:30Z'), 'Asia/Tokyo'), 'あと 0h 1m')
})

test('しおりの入れ替え：長押しの前に指が動いたら、行は取らずにスクロールにする', () => {
  assert.equal(pressMovedTooFar(3, 4), false)
  assert.equal(pressMovedTooFar(0, 12), true)
})

test('しおりの行を動かす：指の高さで、差し込む位置（行と行のあいだ）が決まる。順番が変わらない位置は落とせない', () => {
  const bands = [
    { pinId: 'a', top: 0, bottom: 64 },
    { pinId: 'b', top: 64, bottom: 128 },
    { pinId: 'c', top: 140, bottom: 204 },
  ]
  // a を下へ：b の真ん中を過ぎたら b の下（b の位置に入る）、c の真ん中を過ぎたら c の下
  assert.equal(insertionAt(90, bands, 'a'), null)
  assert.deepEqual(insertionAt(100, bands, 'a'), { to: 'b', after: true })
  assert.deepEqual(insertionAt(132, bands, 'a'), { to: 'b', after: true })
  assert.deepEqual(insertionAt(300, bands, 'a'), { to: 'c', after: true })
  // c を上へ：b の真ん中より上なら b の上、a の真ん中より上なら a の上
  assert.equal(insertionAt(120, bands, 'c'), null)
  assert.deepEqual(insertionAt(80, bands, 'c'), { to: 'b', after: false })
  assert.deepEqual(insertionAt(-20, bands, 'c'), { to: 'a', after: false })
  // 取っている行のすぐ上とすぐ下は、順番が変わらないので落とせない。行が見つからなければ null
  assert.equal(insertionAt(70, bands, 'b'), null)
  assert.equal(insertionAt(135, bands, 'b'), null)
  assert.equal(insertionAt(10, bands, 'gone'), null)
})

test('しおりの入れ替え：欄の上下の端に指があると、そちらへ欄を動かす', () => {
  assert.equal(autoScrollStep(300, 100, 500), 0)
  assert.ok(autoScrollStep(105, 100, 500) < 0)
  assert.ok(autoScrollStep(495, 100, 500) > 0)
  assert.ok(autoScrollStep(60, 100, 500) >= -12)
})

test('しおりの行を動かす：保存を待つあいだは、取った行を落とした位置に差し込み、あいだの行をずらす。時刻はそのまま。新しいしおりが届けばそちら', () => {
  const route = {
    revision: 2,
    pinIds: ['a', 'b', 'c'],
    schedule: [
      { day: 1, time: '09:00', pinId: null, name: '東京駅 出発', stayMinutes: 0, moveMinutesToNext: 90 },
      { day: 1, time: '10:30', pinId: 'a', name: 'A', stayMinutes: 60, moveMinutesToNext: 30 },
      { day: 1, time: '12:00', pinId: 'b', name: 'B', stayMinutes: 60, moveMinutesToNext: 30 },
      { day: 2, time: '09:00', pinId: 'c', name: 'C', stayMinutes: 60, moveMinutesToNext: null },
    ],
  }
  const shown = movedRoute(route, { from: 'a', to: 'c', revision: 2 })
  assert.deepEqual(shown.pinIds, ['b', 'c', 'a'])
  assert.deepEqual(shown.schedule.map((stop) => [stop.day, stop.time, stop.pinId, stop.name]), [
    [1, '09:00', null, '東京駅 出発'],
    [1, '10:30', 'b', 'B'],
    [1, '12:00', 'c', 'C'],
    [2, '09:00', 'a', 'A'],
  ])
  assert.equal(movedRoute(route, { from: 'a', to: 'c', revision: 1 }), route)
  assert.equal(movedRoute(route, null), route)
  assert.equal(movedRoute(route, { from: 'a', to: 'gone', revision: 2 }), route)
})

test('しおりの行を動かす：同じ場所が 2 回あるしおりでは、行の ID で動かす（#528）', () => {
  const stop = (time, pinId, name, stopId) => ({ day: 1, time, pinId, name, stayMinutes: 60, moveMinutesToNext: null, ...(stopId ? { stopId } : {}) })
  const route = { revision: 0, pinIds: ['ski', 'ski~2', 'inn', 'soba'], schedule: [stop('09:00', 'ski', 'スキー場'), stop('10:00', 'ski', 'スキー場', 'ski~2'), stop('11:00', 'inn', '宿'), stop('12:00', 'soba', 'そば')] }
  const shown = movedRoute(route, { from: 'ski~2', to: 'soba', revision: 0 })
  assert.deepEqual(shown.pinIds, ['ski', 'inn', 'soba', 'ski~2'])
  assert.deepEqual(shown.schedule.map((item) => [item.time, item.pinId, item.stopId]), [['09:00', 'ski', undefined], ['10:00', 'inn', undefined], ['11:00', 'soba', undefined], ['12:00', 'ski', 'ski~2']])
  // 上へ動かす：そばを、複製した行の上に差し込む
  assert.deepEqual(movedRoute(route, { from: 'soba', to: 'ski~2', revision: 0 }).pinIds, ['ski', 'soba', 'ski~2', 'inn'])
})

test('しおりの行の ID：複製した行は stopId、ほかはピンの ID。同じ場所の行の数を数える（#528）', () => {
  assert.equal(stopIdOf({ pinId: 'ski' }), 'ski')
  assert.equal(stopIdOf({ pinId: 'ski', stopId: 'ski~2' }), 'ski~2')
  assert.equal(stopIdOf({ pinId: null }), null)
  assert.equal(pinOfStop('ski~2'), 'ski')
  assert.equal(pinOfStop('ski'), 'ski')
  assert.deepEqual([...visitCounts([{ pinId: null }, { pinId: 'ski' }, { pinId: 'inn' }, { pinId: 'ski' }])], [['ski', 2], ['inn', 1]])
  // 道の形は、行の ID の区間のキーで引く
  const at = (lat) => ({ lat, lng: 0 })
  const points = roadLinePoints([{ id: 'inn', location: at(0) }, { id: 'ski~2', location: at(2) }], [{ key: 'inn>ski~2', points: [at(0), at(1), at(2)] }])
  assert.deepEqual(points.map((point) => point.lat), [0, 1, 2])
})

test('大まかな場所：重なりと知らない地方を落とし、北から南の順にそろえる', () => {
  assert.deepEqual(normalizeRegions(['kyushu', 'tohoku', 'tohoku', 'tokyo']), ['tohoku', 'kyushu'])
  assert.deepEqual(toggleRegion(['kyushu'], 'tohoku'), ['tohoku', 'kyushu'])
  assert.deepEqual(toggleRegion(['tohoku', 'kyushu'], 'tohoku'), ['kyushu'])
})

test('大まかな場所：選んだ地方の名前。すべて選ぶと場所を絞らない', () => {
  assert.equal(regionsLabel(['hokuriku', 'tohoku']), '東北・北陸')
  assert.equal(regionsLabel([]), '')
  assert.equal(regionsLabel([...REGION_IDS]), '全国')
  assert.equal(isAllRegions([...REGION_IDS]), true)
  assert.equal(isAllRegions(['tohoku']), false)
  assert.equal(regionsShortLabel(['tohoku', 'hokuriku']), '東北・北陸')
  assert.equal(regionsShortLabel(['tohoku', 'hokuriku', 'kinki']), '東北ほか2')
  assert.equal(regionsShortLabel([...REGION_IDS]), '全国')
})

test('大まかな場所：1 つも選んでいなければ、旅を作れない', () => {
  assert.notEqual(regionsProblem([]), null)
  assert.equal(regionsProblem(['okinawa']), null)
})

test('大まかな場所：どの地方にも、日本のあたりの範囲の形がある', () => {
  for (const id of REGION_IDS) {
    const rings = regionRings(id)
    assert.ok(rings.length > 0, id)
    for (const ring of rings) {
      assert.ok(ring.length >= 3, id)
      for (const { lat, lng } of ring) assert.ok(lat > 24 && lat < 46 && lng > 122 && lng < 146, `${id} ${lat},${lng}`)
    }
  }
})

test('県で絞る：地方を押すとその県が全部、県を押すと 1 つずつ。旅には絞ったときだけ県を残す', () => {
  let picked = toggleRegionPrefectures([], 'koshinetsu')
  assert.deepEqual(picked, ['新潟県', '山梨県', '長野県'])
  assert.deepEqual(toTripArea(picked), { regions: ['koshinetsu'], prefectures: null })
  picked = togglePrefecture(picked, '新潟県')
  picked = toggleRegionPrefectures(picked, 'hokuriku')
  assert.deepEqual(toTripArea(picked), { regions: ['koshinetsu', 'hokuriku'], prefectures: ['山梨県', '長野県', '富山県', '石川県', '福井県'] })
  assert.equal(pickedLabel(picked), '山梨県・長野県・北陸')
  assert.equal(pickedShortLabel(picked), '山梨県ほか2')
  // 一部だけ選んだ地方を押すと、その地方の県を全部外す
  assert.deepEqual(toggleRegionPrefectures(picked, 'koshinetsu'), ['富山県', '石川県', '福井県'])
  // 旅から戻す
  assert.deepEqual(pickedFromTrip(['hokuriku'], undefined), ['富山県', '石川県', '福井県'])
  assert.deepEqual(pickedFromTrip(['koshinetsu'], ['長野県']), ['長野県'])
})


test('大まかな場所を名前で探す：漢字の一部でも、読みの頭でも、カタカナでも当たる', () => {
  assert.deepEqual(searchAreas('なが'), { regions: [], prefectures: ['長野県', '長崎県'] })
  assert.deepEqual(searchAreas('ナガノ').prefectures, ['長野県'])
  assert.deepEqual(searchAreas('甲信').regions, ['koshinetsu'])
  // 県が 1 つだけの地方は、地方だけを出す（「沖縄」と「沖縄県」を重ねて出さない）
  assert.deepEqual(searchAreas('おきなわ'), { regions: ['okinawa'], prefectures: [] })
  assert.deepEqual(searchAreas('北海道'), { regions: ['hokkaido'], prefectures: [] })
  assert.deepEqual(searchAreas('  '), { regions: [], prefectures: [] })
})

test('大まかな場所：一覧で地方をまるごと選ぶ・外す（一部だけ選んでいた地方は、まるごと選ぶ）', () => {
  assert.deepEqual(setRegionPrefectures(['長野県'], 'koshinetsu', true), ['新潟県', '山梨県', '長野県'])
  assert.deepEqual(setRegionPrefectures(['新潟県', '山梨県', '長野県', '富山県'], 'koshinetsu', false), ['富山県'])
})

test('しおりビュー：日ごとに分け、先頭の集合場所の行から「 出発」を外す。ピンのないほかの行は other', () => {
  const stop = (day, pinId, name, extra = {}) => ({ day, time: '10:00', pinId, name, stayMinutes: 60, moveMinutesToNext: 30, category: null, wisher: null, wishText: null, ...extra })
  const days = shioriBookDays({
    startDate: '2026-12-31',
    stops: [stop(1, null, '新宿駅 出発'), stop(1, 'p1', '白骨温泉'), stop(2, null, '松本の宿', { kind: 'lodging' }), stop(2, 'p2', 'わさび農場')],
  })
  assert.deepEqual(days.map((day) => [day.day, day.date]), [[1, '2026-12-31'], [2, '2027-01-01']])
  assert.deepEqual(days[0].rows.map((row) => [row.kind, row.name]), [['origin', '新宿駅'], ['place', '白骨温泉']])
  assert.deepEqual(days[1].rows.map((row) => row.kind), ['other', 'place'])
})

test('しおりビュー：同じ場所が 2 回あるしおりでは、複製した行に行の ID を写す（時刻と区間を行ごとに指すため。#528）', () => {
  const trip = { title: '旅', startDate: '2026-11-21', endDate: null, origin: '' }
  const schedule = [
    { day: 1, time: '10:00', pinId: 'ski', name: 'スキー場', stayMinutes: 60, moveMinutesToNext: 10 },
    { day: 1, time: '11:10', pinId: 'inn', name: '宿', stayMinutes: 60, moveMinutesToNext: 10 },
    { day: 1, time: '12:20', pinId: 'ski', stopId: 'ski~2', name: 'スキー場', stayMinutes: 60, moveMinutesToNext: null },
  ]
  const rows = shioriBookDays(shioriBookOf(trip, schedule, [], [], [])).flatMap((day) => day.rows)
  assert.deepEqual(rows.map((row) => [row.pinId, row.stopId, row.time]), [['ski', undefined, '10:00'], ['inn', undefined, '11:10'], ['ski', 'ski~2', '12:20']])
  assert.equal('stopId' in rows[0], false)
})

test('しおりビュー：今のしおりの行をそのまま写し、集合場所の行と、場所の種類・希望した人・やりたいことを足す', () => {
  const trip = { title: '秋の信州', startDate: '2026-11-21', endDate: '2026-11-22', origin: '新宿駅' }
  const schedule = [
    { day: 1, time: '10:00', pinId: 'p1', name: '白骨温泉', stayMinutes: 60, moveMinutesToNext: 40 },
    { day: 2, time: '09:00', pinId: 'p2', name: 'わさび農場', stayMinutes: 90, moveMinutesToNext: null, kind: 'place' },
  ]
  const places = [
    { id: 'p1', category: 'onsen', uid: 'a', wishId: 'w1' },
    { id: 'p2', category: 'farm', uid: 'gone', wishId: 'w9' },
  ]
  const members = [{ id: 'a', displayName: 'ゆう', color: '#ff8800' }, { id: 'b', displayName: 'かめ', color: '#0088ff' }]
  const book = shioriBookOf(trip, schedule, places, members, [{ id: 'w1', text: '温泉に入りたい' }])
  assert.deepEqual([book.title, book.startDate, book.endDate, book.origin], ['秋の信州', '2026-11-21', '2026-11-22', '新宿駅'])
  assert.deepEqual(book.members, [{ name: 'ゆう', color: '#ff8800' }, { name: 'かめ', color: '#0088ff' }])
  // 出発地の位置が分からず出発の行がないしおりには、時刻なしの集合場所の行を先頭に足す
  assert.deepEqual(book.stops.map((stop) => [stop.day, stop.time, stop.pinId, stop.name]), [
    [1, '', null, '新宿駅 出発'],
    [1, '10:00', 'p1', '白骨温泉'],
    [2, '09:00', 'p2', 'わさび農場'],
  ])
  assert.deepEqual(book.stops[1].wisher, { name: 'ゆう', color: '#ff8800' })
  assert.equal(book.stops[1].wishText, '温泉に入りたい')
  assert.equal(book.stops[1].category, 'onsen')
  // 抜けた人の場所、消えた希望は、人とやりたいことを null にして行は残す。行の種類などはそのまま写す
  assert.deepEqual([book.stops[2].wisher, book.stops[2].wishText, book.stops[2].kind], [null, null, 'place'])
  assert.deepEqual([book.stops[0].category, book.stops[0].wisher, book.stops[0].wishText], [null, null, null])
  // もう出発の行があれば足さない
  const withOrigin = shioriBookOf(trip, [{ day: 1, time: '09:00', pinId: null, name: '新宿駅 出発', stayMinutes: 0, moveMinutesToNext: 30, meetTime: '08:45' }, ...schedule], places, members, [])
  assert.equal(withOrigin.stops.length, 3)
  assert.equal(withOrigin.stops[0].meetTime, '08:45')
  // Google マップに渡すのは建った場所の名前だけ。場所がなければ、書き出すものがない
  assert.deepEqual(shioriBookPlaceNames(book), ['白骨温泉', 'わさび農場'])
  assert.equal(shioriBookHasPlaces(book), true)
  assert.equal(shioriBookHasPlaces(shioriBookOf(trip, [], places, members, [])), false)
  assert.equal(shioriBookHasPlaces(shioriBookOf(trip, [{ day: 1, time: '09:00', pinId: null, name: '新宿駅 出発', stayMinutes: 0, moveMinutesToNext: null }], places, members, [])), false)
})

test('しおりビュー：PDF のファイル名に、ファイル名に使えない文字を入れない', () => {
  assert.equal(shioriBookFileName({ title: '秋の信州' }), '秋の信州のしおり.pdf')
  assert.equal(shioriBookFileName({ title: 'A/B:C?' }), 'A＿B＿C＿のしおり.pdf')
  assert.equal(shioriBookFileName({ title: '  ' }), '旅のしおり.pdf')
})

test('PDF：JPEG を 1 枚ずつページにし、xref の位置がオブジェクトの位置と合う', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const pdf = jpegPagesToPdf([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }])
  const text = Buffer.from(pdf).toString('latin1')
  assert.ok(text.startsWith('%PDF-1.4'))
  assert.ok(text.trimEnd().endsWith('%%EOF'))
  assert.match(text, /\/Count 2/)
  assert.equal(text.match(/\/Subtype \/Image/g).length, 2)
  // startxref が指す位置に xref があり、各オブジェクトの位置が「n 0 obj」を指す
  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1])
  assert.ok(text.startsWith('xref', xrefAt))
  const entries = text.slice(xrefAt).split('\n').slice(3).filter((line) => line.endsWith(' n '))
  entries.forEach((line, index) => assert.ok(text.startsWith(`${index + 1} 0 obj`, Number(line.slice(0, 10)))))
})

test('しおりの PDF：文字ごとに折り返し、句読点を行の頭に置かない。行の数を超えたら「…」で切る', () => {
  const measure = (text) => Array.from(text).length * 10
  assert.deepEqual(wrapText(measure, 'あいうえおかきく', 30), ['あいう', 'えおか', 'きく'])
  assert.deepEqual(wrapText(measure, 'あいう。えお', 30), ['あいう。', 'えお'])
  assert.deepEqual(wrapText(measure, 'あいうえおかきく', 30, 2), ['あいう', 'えお…'])
})

test('しおりの PDF：入りきらないかたまりは次のページへ送り、日の途中なら「つづき」の見出しを頭に足す', () => {
  const day = { day: 1, date: '2026-11-21', rows: [] }
  const blocks = [{ height: 600 }, { height: 300, day }, { height: 300, day }]
  const placed = paginate(blocks, () => ({ height: 48, heading: true }))
  assert.deepEqual(placed.map((item) => [item.page, item.block.heading === true]), [[0, false], [0, false], [1, true], [1, false]])
  // どのかたまりも、下の余白に入り込まない
  for (const item of placed) assert.ok(item.top + item.block.height <= PAGE.height)
})

test('カレンダーへの書き出し：しおりの行を場所ごとの予定にする。時刻から滞在の長さまで、日をまたぐ時刻も正しい日付にする', () => {
  const stop = (day, time, pinId, name, stayMinutes, extra = {}) => ({ day, time, pinId, name, stayMinutes, moveMinutesToNext: null, category: null, wisher: null, wishText: null, ...extra })
  const final = {
    title: '秋の信州',
    startDate: '2026-12-31',
    origin: '新宿駅',
    stops: [
      stop(1, '09:00', null, '新宿駅 出発', 0),
      stop(1, '10:40', 'p1', '美ヶ原高原', 90, { wisher: { name: 'みお', color: '#1676d1' }, wishText: '深呼吸したい' }),
      stop(1, '23:30', 'p2', '星空の丘', 60),
      stop(2, '09:30', 'p3', '松本城', 90),
    ],
  }
  const events = calendarEvents(shioriBookDays(final), final.title, 'trip-1')
  assert.deepEqual(events.map((event) => [event.summary, event.start.dateTime, event.end.dateTime]), [
    // 集合場所は、集合時間（前の形の行は出発の 15 分前）から出発時間まで
    ['新宿駅に集合・出発', '2026-12-31T08:45:00', '2026-12-31T09:00:00'],
    ['美ヶ原高原', '2026-12-31T10:40:00', '2026-12-31T12:10:00'],
    ['星空の丘', '2026-12-31T23:30:00', '2027-01-01T00:30:00'],
    ['松本城', '2027-01-01T09:30:00', '2027-01-01T11:00:00'],
  ])
  // 集合時間を決めてあれば、そこから。出発より遅い集合時間なら、出発から 15 分
  const withMeet = (meetTime) => calendarEvents(shioriBookDays({ ...final, stops: [stop(1, '09:00', null, '新宿駅 出発', 0, { meetTime }), ...final.stops.slice(1)] }), final.title, 'trip-1')[0]
  assert.deepEqual([withMeet('08:20').start.dateTime, withMeet('08:20').end.dateTime], ['2026-12-31T08:20:00', '2026-12-31T09:00:00'])
  assert.deepEqual([withMeet('09:30').start.dateTime, withMeet('09:30').end.dateTime], ['2026-12-31T09:00:00', '2026-12-31T09:15:00'])
  assert.equal(events[0].start.timeZone, 'Asia/Tokyo')
  assert.equal(events[1].description, '「深呼吸したい」（みおのやりたいこと）\n\n秋の信州のしおり（たびむすび）')
  assert.deepEqual(eventsByDate(events).map((day) => [day.date, day.events.length]), [['2026-12-31', 3], ['2027-01-01', 1]])
  assert.equal(calendarDayUrl('2026-12-31'), 'https://calendar.google.com/calendar/r/day/2026/12/31')
})

test('カレンダーへの書き出し：予定の ID は Calendar に使える字（0-9、a-v）で、同じ旅の同じ行なら何度作っても同じ。時刻のない行は入れない', () => {
  const stops = [
    { day: 1, time: '', pinId: null, name: '新宿駅 出発', stayMinutes: 0, moveMinutesToNext: null, category: null, wisher: null, wishText: null },
    { day: 1, time: '10:00', pinId: 'p1', name: '白骨温泉', stayMinutes: 60, moveMinutesToNext: null, category: null, wisher: null, wishText: null },
  ]
  const days = shioriBookDays({ startDate: '2026-11-21', stops })
  const first = calendarEvents(days, '旅', 'trip-1')
  assert.equal(first.length, 1)
  assert.match(first[0].id, /^[0-9a-v]{5,1024}$/)
  // 時刻のない行（先頭の集合場所）も番号は数える。あとから時刻が付いても、ほかの行の ID は変わらない
  assert.ok(first[0].id.endsWith('1'))
  assert.equal(calendarEvents(days, '旅', 'trip-1')[0].id, first[0].id)
  assert.notEqual(calendarEvents(days, '旅', 'trip-2')[0].id, first[0].id)
})

test('人の切り替えの印：立てると、その接続だけが切り替え中になり、下ろすと戻る。変わったときだけ知らせる', () => {
  const a = {}
  const b = {}
  let calls = 0
  const stop = subscribeSwitching(() => calls++)
  assert.equal(isSwitchingAccount(a), false)
  markSwitching(a, true)
  assert.equal(isSwitchingAccount(a), true)
  assert.equal(isSwitchingAccount(b), false)
  markSwitching(a, true)
  assert.equal(calls, 1)
  markSwitching(a, false)
  assert.equal(isSwitchingAccount(a), false)
  assert.equal(calls, 2)
  stop()
  markSwitching(a, true)
  assert.equal(calls, 2)
  markSwitching(a, false)
})

test('建った建物のカード：別の人が建てたら、その人の名前を出す', () => {
  assert.equal(builtState('みお', false, true), 'みおが建てました')
  assert.equal(builtState('みお', false, false), 'みおが建てました（用意した部品の模型です）')
})

test('建った建物のカード：希望を書いた人が自分で建てたら、名前を繰り返さない', () => {
  assert.equal(builtState('あき', true, true), undefined)
  assert.equal(builtState('あき', true, false), '用意した部品の模型です')
})

test('建った建物のカード：建てた人が抜けて名前が分からないとき', () => {
  assert.equal(builtState(null, false, true), undefined)
  assert.equal(builtState(null, false, false), '用意した部品の模型です')
})

const NO_FRAME = { halfWidth: 9, halfHeight: 9, middle: 4 }
const flat = (x, y) => [x, y]

test('回す模型の範囲：どの向きに回しても、いちばん外側の点が収まる', () => {
  // 軸から 1 離れた点は、回すと左右に ±1 まで動く。高さ 0〜2 の点は、上下の真ん中が 1
  const frame = turntableFrame([[1, 0, 0], [0, 2, 0]], flat, NO_FRAME)
  assert.ok(Math.abs(frame.halfWidth - 1.04) < 1e-9)
  assert.ok(Math.abs(frame.halfHeight - 1.04) < 1e-9)
  assert.equal(frame.middle, 1)
})

test('回す模型の範囲：頂点がなければ、決めておいた範囲', () => {
  assert.deepEqual(turntableFrame([], flat, NO_FRAME), NO_FRAME)
})

test('回す模型の範囲：横長の絵では左右を広げ、縦長の絵では上下を広げる。模型は真ん中', () => {
  const frame = { halfWidth: 2, halfHeight: 2, middle: 1 }
  assert.deepEqual(fitFrame(frame, 2), { left: -4, right: 4, top: 3, bottom: -1 })
  assert.deepEqual(fitFrame(frame, 0.5), { left: -2, right: 2, top: 5, bottom: -3 })
})

test('時刻の入力：数字だけで 24 時間制の時刻を打つ。時刻にならない数字は受け付けない', () => {
  const type = (keys) => [...keys].reduce(pushClockDigit, '')
  assert.equal(type('0930'), '0930')
  // 1 けた目が 3〜9 なら、時の頭に 0 を補う
  assert.equal(type('930'), '0930')
  assert.equal(type('2359'), '2359')
  // 24 時より上、60 分より上、5 けた目は受け付けない
  assert.equal(type('24'), '2')
  assert.equal(type('127'), '12')
  assert.equal(type('12345'), '1234')
  assert.equal(formatClockDigits('093'), '09:3')
  assert.equal(formatClockDigits('09'), '09')
  // 入力欄の文字が変わったとき：足した数字は確かめ、消したら減らす。コロンだけを消したら、その前の数字を消す
  assert.equal(nextClockDigits('09', '093'), '093')
  assert.equal(nextClockDigits('093', '09:'), '09')
  assert.equal(nextClockDigits('093', '093'), '09')
  assert.equal(nextClockDigits('', '1230'), '1230')
  assert.equal(nextClockDigits('12', '12:9'), '12')
  // 打った数字を分にする。足りなければ、時ちょうど・10 分きざみ
  assert.equal(clockFromDigits('0930'), 570)
  assert.equal(clockFromDigits('09'), 540)
  assert.equal(clockFromDigits('093'), 570)
  assert.equal(clockFromDigits(''), null)
  assert.equal(clockMinutes('23:59'), 1439)
  assert.equal(clockMinutes('24:00'), null)
  assert.equal(clockLabel(570), '09:30')
})

test('しおりビュー：集合場所の行に集合時間を入れる。前の形の行は出発の 15 分前、時刻のない行と場所の行は null', () => {
  const stop = (time, pinId, extra = {}) => ({ day: 1, time, pinId, name: pinId ? '白骨温泉' : '新宿駅 出発', stayMinutes: 0, moveMinutesToNext: null, category: null, wisher: null, wishText: null, ...extra })
  const meetOf = (stops) => shioriBookDays({ startDate: '2026-11-21', stops })[0].rows.map((row) => row.meetTime)
  assert.deepEqual(meetOf([stop('09:00', null, { meetTime: '08:30' }), stop('10:00', 'p1')]), ['08:30', null])
  assert.deepEqual(meetOf([stop('09:00', null), stop('10:00', 'p1')]), ['08:45', null])
  assert.deepEqual(meetOf([stop('', null), stop('10:00', 'p1')]), [null, null])
})

// しおりの時刻を直し終えたら、iPhone の Safari が拡大した画面を戻す（#468）。window と document を差し替えて確かめる
import { pageZoom, restorePageZoom } from '../web/src/shared/lib/pageZoom.ts'

function fakePage(scale, content = 'width=device-width, initial-scale=1.0, viewport-fit=cover') {
  const meta = { content }
  const timers = []
  const scrolls = []
  globalThis.window = {
    visualViewport: { scale },
    scrollX: 0,
    scrollY: 40,
    scrollTo: (x, y) => scrolls.push([x, y]),
    setTimeout: (fn) => timers.push(fn),
  }
  globalThis.document = { querySelector: () => meta }
  const cleanup = () => {
    delete globalThis.window
    delete globalThis.document
  }
  return { meta, timers, scrolls, cleanup }
}

test('入力の間に拡大されたら、maximum-scale=1 を一時的に足して戻し、あとで viewport を元の内容と位置に戻す', () => {
  const page = fakePage(1)
  try {
    const before = pageZoom()
    window.visualViewport.scale = 1.6
    restorePageZoom(before)
    assert.equal(page.meta.content, 'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1')
    assert.equal(page.timers.length, 1)
    page.timers[0]()
    assert.equal(page.meta.content, 'width=device-width, initial-scale=1.0, viewport-fit=cover')
    assert.deepEqual(page.scrolls, [[0, 40]])
  } finally {
    page.cleanup()
  }
})

test('拡大されていない、押す前から指で拡大していた、元から maximum-scale があるときは、viewport を変えない', () => {
  for (const [beforeScale, afterScale, content] of [
    [1, 1, undefined],
    [1.5, 2, undefined],
    [1, 1.6, 'width=device-width, maximum-scale=5'],
  ]) {
    const page = fakePage(beforeScale, content)
    try {
      const before = pageZoom()
      const original = page.meta.content
      window.visualViewport.scale = afterScale
      restorePageZoom(before)
      assert.equal(page.meta.content, original)
      assert.equal(page.timers.length, 0)
    } finally {
      page.cleanup()
    }
  }
  restorePageZoom(null)
})

test('待つあいだにスクロールが動いたときと、欄が消えたとき（keepScroll が false）は、拡大だけ戻して位置は戻さない', () => {
  for (const [moveDuringWait, keepScroll] of [[true, true], [false, false]]) {
    const page = fakePage(1)
    try {
      const before = pageZoom()
      window.visualViewport.scale = 1.6
      restorePageZoom(before, keepScroll)
      if (moveDuringWait) window.scrollY = 300
      page.timers[0]()
      assert.equal(page.meta.content, 'width=device-width, initial-scale=1.0, viewport-fit=cover')
      assert.deepEqual(page.scrolls, [])
    } finally {
      page.cleanup()
    }
  }
})

test('大まかな場所：どの県と地方にも名物の模型があり、建物と同じ検査を通る', async () => {
  const { readFileSync } = await import('node:fs')
  const { validateModelJson } = await import('../functions/src/domain/model3d.ts')
  const { ALL_PREFECTURES, REGION_IDS: ids } = await import('../web/src/entities/trip/model/regions.ts')
  const { PREFECTURE_SPECIALTIES, REGION_SPECIALTIES, SPECIALTY_NAMES } = await import('../web/src/entities/trip/model/specialties.ts')
  const used = [...ALL_PREFECTURES.map((name) => PREFECTURE_SPECIALTIES[name]), ...ids.flatMap((id) => REGION_SPECIALTIES[id])]
  for (const name of used) {
    assert.ok(name in SPECIALTY_NAMES, name)
    const json = JSON.parse(readFileSync(new URL(`../web/src/entities/model3d/assets/specialties/${name}.json`, import.meta.url), 'utf8'))
    assert.doesNotThrow(() => validateModelJson(json), name)
  }
})

test('大まかな場所：出発地から地方までのまっすぐな距離（km）', async () => {
  const { distanceKm } = await import('../web/src/entities/trip/model/distance.ts')
  const tokyo = { lat: 35.681, lng: 139.767 }
  // 東京駅から大阪駅までは、まっすぐ約 400km
  assert.ok(Math.abs(distanceKm(tokyo, { lat: 34.702, lng: 135.495 }) - 400) < 15)
  assert.equal(distanceKm(tokyo, tokyo), 0)
})

test('地図：日本の外まで動かしたら、日本の側へ戻す（日本の中と、沖縄・対馬はそのまま）', async () => {
  const { backToJapan } = await import('../web/src/widgets/trip-map/lib/mercator.ts')
  assert.equal(backToJapan({ lat: 35.68, lng: 139.77 }), null)
  assert.equal(backToJapan({ lat: 26.2, lng: 127.7 }), null)
  // 沖縄の島々（与那国島まで）を映したときの真ん中も、日本の中
  assert.equal(backToJapan({ lat: 25.5, lng: 125.5 }), null)
  assert.equal(backToJapan({ lat: 34.4, lng: 129.3 }), null)
  assert.ok(backToJapan({ lat: 37.57, lng: 126.98 }).lng >= 129.4)
  assert.equal(backToJapan({ lat: 35, lng: 160 }).lng, 148)
  assert.equal(backToJapan({ lat: 10, lng: 140 }).lat, 24)
})

test('大まかな場所：上の帯は、ふっている → 止まった → 選んだ → まだ、の順に出す', async () => {
  const { pickerBand, tripDatesLabel } = await import('../web/src/entities/trip/model/pickerBand.ts')
  const tokyo = { lat: 35.681, lng: 139.767 }
  const base = { rolling: null, landed: null, places: [], label: '', all: false, origin: '東京駅', home: tokyo, title: '秋の旅', startDate: '2026-03-20', endDate: '2026-03-22' }
  assert.deepEqual(pickerBand(base), { sub: '秋の旅・3/20〜22', main: 'どこへ行こう？', picked: false })
  assert.equal(pickerBand({ ...base, title: '' }).sub, '新しい旅・3/20〜22')
  assert.equal(pickerBand({ ...base, rolling: '東北' }).main, '東北？')
  assert.equal(pickerBand({ ...base, landed: '東北', label: '東北' }).main, '東北に決まり！')
  const sapporo = { name: '北海道', point: { lat: 43.06, lng: 141.35 } }
  const picked = pickerBand({ ...base, places: [sapporo], label: '北海道' })
  assert.equal(picked.main, '北海道へ')
  assert.match(picked.sub, /^東京駅から 約\d+0km$/)
  const four = ['北海道', '東北', '関東', '近畿'].map((name) => ({ name, point: tokyo }))
  assert.equal(pickerBand({ ...base, places: four, label: '北海道・東北・関東・近畿' }).main, '北海道・東北 +2へ')
  assert.equal(pickerBand({ ...base, places: [{ name: '関東', point: tokyo }], label: '関東' }).sub, '東京駅から')
  assert.equal(tripDatesLabel('2026-03-31', '2026-04-02'), '3/31〜4/2')
  assert.equal(tripDatesLabel('2026-03-20', null), '3/20')
})

test('大まかな場所：サイコロは、まだ選んでいない地方に止まり、同じ地方に続けて止まらない', async () => {
  const { rollHops } = await import('../web/src/entities/trip/model/pickerBand.ts')
  const { untouchedRegions, REGION_PREFECTURES } = await import('../web/src/entities/trip/model/regions.ts')
  assert.deepEqual(untouchedRegions([...REGION_PREFECTURES.tohoku, '東京都']).includes('tohoku'), false)
  assert.deepEqual(untouchedRegions(['東京都']).includes('kanto'), false)
  assert.equal(untouchedRegions([]).length, 11)
  let seed = 7
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  const hops = rollHops(['a', 'b', 'c'], 'c', 13, random)
  assert.equal(hops.length, 13)
  assert.equal(hops.at(-1).id, 'c')
  for (let i = 1; i < hops.length - 1; i += 1) assert.notEqual(hops[i].id, hops[i - 1].id)
  for (let i = 1; i < hops.length; i += 1) assert.ok(hops[i].at - hops[i - 1].at >= hops[i - 1].at - (hops[i - 2]?.at ?? 0))
  assert.deepEqual(rollHops(['a', 'b'], 'b', 1, random).map((hop) => hop.id), ['b'])
})

test('時刻：分を足した時刻を出す（しおりの行の、場所を出る時刻）', () => {
  assert.equal(clockAfter('12:40', 60), '13:40')
  assert.equal(clockAfter('09:05', 25), '09:30')
  // 0 時をまたいだら、次の日の時刻に折り返す
  assert.equal(clockAfter('23:30', 60), '00:30')
  // 時刻のない行、いる時間のない行には出さない
  assert.equal(clockAfter('', 60), null)
  assert.equal(clockAfter('12:40', 0), null)
})

// 旅をつくる画面（S01）：日程の季節
import { seasonOf } from '../web/src/entities/trip/model/season.ts'

test('旅の季節：3〜5 月は春、6〜8 月は夏、9〜11 月は秋、12〜2 月は冬', () => {
  assert.equal(seasonOf('2026-03-01'), 'spring')
  assert.equal(seasonOf('2026-08-31'), 'summer')
  assert.equal(seasonOf('2026-11-21'), 'autumn')
  assert.equal(seasonOf('2026-12-19'), 'winter')
  assert.equal(seasonOf('2027-02-28'), 'winter')
})

import { FLAKE_COUNTS, flakeLooks } from '../web/src/pages/trip-create/model/seasonFlakes.ts'

test('地図に重ねる舞うもの：同じ数なら毎回同じ位置と速さ。夏は舞わない', () => {
  assert.equal(FLAKE_COUNTS.summer, 0)
  assert.deepEqual(flakeLooks(5, ['#000']), flakeLooks(5, ['#000']))
  assert.equal(flakeLooks(26, ['#000']).length, 26)
})

import { calendarMonth, shiftMonth } from '../web/src/entities/trip/model/calendar.ts'

test('旅をつくるカレンダー：今日より前は押せず、行く日から帰る日までを帯でつなぐ', () => {
  const month = calendarMonth(2026, 10, '2026-11-21', '2026-11-23', '2026-11-21')
  assert.equal(month.lead, 0)
  assert.equal(month.days.length, 30)
  assert.equal(month.atFirstMonth, true)
  const day = (d) => month.days[d - 1]
  assert.equal(day(20).past, true)
  assert.equal(day(21).isToday, true)
  assert.deepEqual([day(21).band, day(22).band, day(23).band, day(24).band], ['right', 'full', 'left', null])
  assert.equal(day(22).inside, true)
  assert.equal(calendarMonth(2026, 10, '2026-11-21', null, '2026-11-21').days[20].band, null)
  assert.equal(calendarMonth(2026, 11, null, null, '2026-11-21').atFirstMonth, false)
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 })
  assert.deepEqual(shiftMonth({ year: 2027, month: 0 }, -1), { year: 2026, month: 11 })
})

import { pickQuizDate, placeReaction, quizDates } from '../web/src/pages/trip-create/model/quizAnswers.ts'

test('旅をつくる問い：カレンダーは 1 回目が行く日、2 回目が帰る日。前の日や同じ日を押したときは選び直す', () => {
  const blank = { name: '', info: { title: '', startDate: '2026-11-21', endDate: null, origin: '' }, dated: false, awaitingEnd: false, mode: null }
  const first = { ...blank, ...pickQuizDate(blank, '2026-11-25') }
  assert.deepEqual([first.info.startDate, first.info.endDate, first.dated, first.awaitingEnd], ['2026-11-25', null, true, true])
  assert.deepEqual(quizDates(first), { start: '2026-11-25', end: null })
  const second = { ...first, ...pickQuizDate(first, '2026-11-27') }
  assert.deepEqual([second.info.endDate, second.awaitingEnd], ['2026-11-27', false])
  assert.deepEqual(quizDates(second), { start: '2026-11-25', end: '2026-11-27' })
  // 帰る日を待っているときに行く日より前を押したら、行く日を選び直す
  const earlier = pickQuizDate(first, '2026-11-23')
  assert.deepEqual([earlier.info.startDate, earlier.info.endDate, earlier.awaitingEnd], ['2026-11-23', null, true])
  // 同じ日をもう一度押したら日帰り
  const sameDay = pickQuizDate(first, '2026-11-25')
  assert.deepEqual([sameDay.info.endDate, sameDay.awaitingEnd], [null, false])
  // 帰る日まで選んだあとに押したら、行く日からやり直す
  assert.deepEqual(pickQuizDate(second, '2026-12-01').info, { ...second.info, startDate: '2026-12-01', endDate: null })
  assert.equal(quizDates(blank), null)
})

test('旅をつくる問い：「どこに行く？」の一言は、選ぶ前・選んだ・サイコロの様子で変わる', () => {
  assert.deepEqual(placeReaction({ sub: '金沢 カニ旅・11/21〜23', main: 'どこへ行こう？', picked: false }, false, false), { text: '地方を選んでね。サイコロでもいいよ', tone: 'idle' })
  assert.deepEqual(placeReaction({ sub: '東京駅から 約290km', main: '北陸へ', picked: true }, false, false), { text: '北陸へ！ 東京駅から約290km', tone: 'picked' })
  assert.deepEqual(placeReaction({ sub: '', main: '北陸へ', picked: true }, false, false), { text: '北陸へ！', tone: 'picked' })
  assert.deepEqual(placeReaction({ sub: 'サイコロをふっています…', main: '北陸？', picked: false }, true, false), { text: 'サイコロをふっています… 北陸？', tone: 'rolling' })
  assert.deepEqual(placeReaction({ sub: 'サイコロの目は…', main: '北陸に決まり！', picked: false }, false, true), { text: '北陸に決まり！', tone: 'landed' })
})

test('発案者：今いるメンバーのうち、いちばん早く入った人。抜けたら次に入った人（Functions の domain/tripOwner と同じ決まり）', () => {
  const member = (id, at) => ({ id, joinedAt: at === null ? null : { toMillis: () => at } })
  assert.equal(ownerUidOf([member('c', 300), member('a', 100), member('b', 200)]), 'a')
  assert.equal(ownerUidOf([member('c', 300), member('b', 200)]), 'b')
  assert.equal(ownerUidOf([member('x', null), member('c', 300)]), 'c')
  assert.equal(ownerUidOf([member('z', 1), member('y', 1)]), 'y')
  assert.equal(ownerUidOf([]), null)
  assert.equal(ownerUidOf(null), null)
})

test('旅程の確定：確定の印があるときだけ確定している。前の形の「決定」は確定ではない', () => {
  assert.equal(isConfirmed({ confirmed: { uid: 'a', at: null } }), true)
  assert.equal(isConfirmed({ status: 'decided' }), false)
  assert.equal(isConfirmed(null), false)
})

import { originFindingReaction } from '../web/src/pages/trip-create/model/quizAnswers.ts'

test('出発地を引いているときの一言：探している・見つからない・まだ探せない。引けたらふだんの一言に戻す', () => {
  assert.equal(originFindingReaction('finding', '下北沢'), '下北沢を探しています…')
  assert.ok(originFindingReaction('not-found', '下北沢').startsWith('見つからなかったよ'))
  assert.ok(originFindingReaction('unavailable', '下北沢').startsWith('ここはまだ探せないよ'))
  assert.equal(originFindingReaction('resolved', '下北沢'), null)
})

import { dateReaction } from '../web/src/pages/trip-create/model/quizAnswers.ts'

test('「いつ行く？」の一言：選んだ日数だけ（日帰り、1泊2日）', () => {
  const info = { title: '', startDate: '2026-11-28', endDate: null, origin: '' }
  assert.equal(dateReaction({ info, dated: false, awaitingEnd: false }), '行く日を押してね')
  assert.equal(dateReaction({ info, dated: true, awaitingEnd: true }), '日帰り')
  assert.equal(dateReaction({ info: { ...info, endDate: '2026-11-29' }, dated: true, awaitingEnd: false }), '1泊2日')
  assert.equal(dateReaction({ info: { ...info, endDate: '2026-12-01' }, dated: true, awaitingEnd: false }), '3泊4日')
  assert.equal(originFindingReaction('error', '下北沢'), 'つながらなかったよ。もう一度決定を押してね')
})

test('チュートリアル：右半分のタップで次、左半分のタップで前（最初の 1 枚はどこでも次）。動かしたらタップにしない', () => {
  assert.equal(tapMove(0, 0, 0.8), 'next')
  assert.equal(tapMove(3, -4, 0.5), 'next')
  assert.equal(tapMove(0, 0, 0.1), 'prev')
  assert.equal(tapMove(0, 0, 0.45), 'prev')
  assert.equal(tapMove(0, 0, 0.1, false), 'next')
  assert.equal(tapMove(0, 40, 0.8), null)
  assert.equal(tapMove(30, 30, 0.1), null)
})

test('チュートリアル：最後の 1 枚から次へ進むと終わり、最初の 1 枚から前へは動かない', () => {
  assert.equal(stepAfter(0, 3, 'next'), 1)
  assert.equal(stepAfter(1, 3, 'prev'), 0)
  assert.equal(stepAfter(0, 3, 'prev'), 0)
  assert.equal(stepAfter(2, 3, 'next'), 'done')
  assert.equal(stepAfter(0, 1, 'next'), 'done')
})

import { memoOriginLookup } from '../web/src/features/create-trip/model/originLookup.ts'

test('出発地を引く：表にある名前は関数を呼ばず、同じ名前は 1 回だけ引き、通信の失敗だけは引き直す', async () => {
  const calls = []
  let fail = false
  const lookup = memoOriginLookup(
    (name) => (name === '横浜駅' ? { lat: 35.47, lng: 139.62 } : null),
    async (name) => {
      calls.push(name)
      if (fail) throw new Error('offline')
      return name === '下北沢' ? { status: 'resolved', point: { name: '下北沢駅', location: { lat: 35.66, lng: 139.67 }, placeId: 'p1' } } : { status: 'not-found' }
    },
  )
  assert.deepEqual(await lookup('横浜駅'), { status: 'resolved', point: { name: '横浜駅', location: { lat: 35.47, lng: 139.62 }, placeId: null } })
  assert.deepEqual(calls, [])
  // 決定とつぎへと出発で 3 回呼んでも、関数は 1 回（引いている途中も同じ結果を待つ）。名前は打った名前にそろえる
  const [a, b] = await Promise.all([lookup('下北沢'), lookup('下北沢')])
  assert.equal((await lookup('下北沢')).point.name, '下北沢')
  assert.equal(a, b)
  assert.deepEqual(calls, ['下北沢'])
  // 見つからなかった名前も引き直さない
  assert.equal((await lookup('ムー大陸')).status, 'not-found')
  assert.equal((await lookup('ムー大陸')).status, 'not-found')
  assert.deepEqual(calls, ['下北沢', 'ムー大陸'])
  // 通信の失敗は覚えず、次は引き直す
  fail = true
  assert.equal((await lookup('品川駅前')).status, 'error')
  fail = false
  assert.equal((await lookup('品川駅前')).status, 'not-found')
  assert.deepEqual(calls, ['下北沢', 'ムー大陸', '品川駅前', '品川駅前'])
})

import { parseStations, stationKey } from '../web/src/entities/trip/model/stations.ts'
import { STATION_ROWS } from '../web/src/entities/trip/model/stationData.ts'

test('全国の駅の表：駅名の「駅」と全角を外して引ける。浜田山や主な駅が入っている', () => {
  assert.equal(stationKey(' 浜田山駅 '), '浜田山')
  assert.equal(stationKey('ＪＲ'), 'JR')
  const table = parseStations(STATION_ROWS)
  assert.ok(table.size > 8000)
  const hamadayama = table.get('浜田山')
  assert.ok(hamadayama && Math.abs(hamadayama.lat - 35.68) < 0.05 && Math.abs(hamadayama.lng - 139.63) < 0.05)
  for (const name of ['東京', '新宿', '横浜', '博多', '那覇空港']) assert.ok(table.has(name), name)
})

import { originLocationWith } from '../web/src/entities/trip/model/originPlaces.ts'

test('出発地の位置：表と名前が同じなら、同じ名前の遠くの駅より表を先に使う。表にない駅は駅の表で引く', () => {
  const table = parseStations(STATION_ROWS)
  const station = (name) => table.get(stationKey(name)) ?? null
  // 駅の表の「福岡」は富山、「山口」は愛知の駅。表と名前が同じなら表（福岡市、山口市）を使う
  assert.ok(table.get('福岡').lat > 36 && table.get('山口').lng > 137)
  assert.deepEqual(originLocationWith('福岡', station), { lat: 33.59, lng: 130.42 })
  assert.deepEqual(originLocationWith('山口駅', station), originLocationWith('山口', () => null))
  assert.ok(originLocationWith('山口駅', station).lng < 132)
  // 表にない駅は駅の表
  assert.deepEqual(originLocationWith('浜田山駅', station), table.get('浜田山'))
  // 駅の名前そのものなら、名前を含む表より駅の表（新宿御苑前は新宿ではない）
  assert.deepEqual(originLocationWith('新宿御苑前', station), table.get('新宿御苑前'))
  // どちらにもなければ、今までどおり名前を含む表
  assert.deepEqual(originLocationWith('新大阪駅の改札', station), { lat: 34.73, lng: 135.5 })
  assert.equal(originLocationWith('自宅', station), null)
})

test('全国の駅の表：画面と Functions の表はまったく同じ（片方だけ作り直していない）', () => {
  const rows = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const web = rows('../web/src/entities/trip/model/stationData.ts')
  assert.ok(web.length > 100000)
  assert.equal(web, rows('../functions/src/domain/stationData.ts'))
})

test('過去の旅：確定していて、最終日を過ぎた旅だけ', () => {
  const confirmed = { uid: 'owner', at: null }
  const trip = (startDate, endDate, isFixed = true) => ({ startDate, endDate, ...(isFixed ? { confirmed } : {}) })
  // 最終日の翌日から、過去の旅
  assert.equal(isPastTrip(trip('2026-10-10', '2026-10-11'), '2026-10-12'), true)
  // 最終日の当日と、旅の途中は、まだ過去の旅ではない
  assert.equal(isPastTrip(trip('2026-10-10', '2026-10-11'), '2026-10-11'), false)
  assert.equal(isPastTrip(trip('2026-10-10', '2026-10-11'), '2026-10-10'), false)
  // 日帰り（終了日なし）は、開始日が最終日
  assert.equal(isPastTrip(trip('2026-10-10', null), '2026-10-11'), true)
  assert.equal(isPastTrip(trip('2026-10-10', null), '2026-10-10'), false)
  // 年や月をまたいでも、日付の順で比べる
  assert.equal(isPastTrip(trip('2025-12-30', '2026-01-02'), '2026-01-03'), true)
  assert.equal(isPastTrip(trip('2026-12-30', '2027-01-02'), '2026-12-31'), false)
  // 確定していない旅は、最終日を過ぎても過去の旅にしない
  assert.equal(isPastTrip(trip('2026-10-10', '2026-10-11', false), '2026-11-21'), false)
  assert.equal(isPastTrip(null, '2026-11-21'), false)
  assert.equal(isPastTrip(undefined, '2026-11-21'), false)
})

test('ごはんの枠：枠を出す位置は、集合場所の「出発」の行と宿の行を数えず、Functions がお店を入れる位置と同じ', () => {
  const row = (time, pinId) => ({ time, pinId })
  // 1 日目：出発の行（場所でない）、城 9:00、そば 13:00、宿 17:00
  const day1 = [row('08:30', null), row('09:00', 'castle'), row('13:00', 'soba'), row('17:00', 'inn')]
  assert.equal(mealSlotIndex(day1, 'breakfast', ['inn']), 1)
  assert.equal(mealSlotIndex(day1, 'lunch', ['inn']), 2)
  assert.equal(mealSlotIndex(day1, 'dinner', ['inn']), 3)
  // 昼より前に着く場所がなければ、最初の場所の前（出発の行のあと）
  assert.equal(mealSlotIndex([row('08:30', null), row('14:00', 'soba')], 'lunch'), 1)
  // 場所のない日は先頭
  assert.equal(mealSlotIndex([row('08:30', null)], 'dinner'), 0)
  assert.equal(mealSlotIndex([], 'breakfast'), 0)
})

test('宿の枠：泊まる夜ごとに、決まっていない・決めない・建物で決まっている、を出す', () => {
  const stop = (day, pinId) => ({ day, time: '10:00', pinId, name: pinId ?? '出発', stayMinutes: 60, moveMinutesToNext: null })
  const route = { schedule: [stop(1, null), stop(1, 'a'), stop(1, 'inn'), stop(2, 'b')], lodging: { 1: 'inn', 2: LODGING_SKIP } }
  assert.deepEqual(lodgingNights(route, 3), [
    { night: 1, state: 'pin', pinId: 'inn' },
    { night: 2, state: 'skip', note: null },
    { night: 3, state: 'open' },
  ])
  assert.equal(openLodgingNight(route, 3), 3)
  assert.equal(openLodgingNight(route, 2), null)
  assert.deepEqual(lodgingStopIds(route), ['inn'])
  // 日帰りの旅には枠がない。宿の項目のない前の形のしおりは、どの夜も決まっていない
  assert.deepEqual(lodgingNights(route, 0), [])
  assert.deepEqual(lodgingNights({ schedule: route.schedule }, 1), [{ night: 1, state: 'open' }])
  assert.deepEqual(lodgingStopIds({}), [])
  // 宿のピンがしおりの行にない（消えた）夜は、決まっていない夜として出す
  assert.deepEqual(lodgingNights({ schedule: [stop(1, 'a')], lodging: { 1: 'inn' } }, 1), [{ night: 1, state: 'open' }])
  // 自分で書いた過ごし方は、印のうしろから読む。宿の行には数えない
  const noted = { schedule: [stop(1, 'a')], lodging: { 1: '@skip:車中泊' } }
  assert.deepEqual(lodgingNights(noted, 1), [{ night: 1, state: 'skip', note: '車中泊' }])
  assert.deepEqual(lodgingStopIds(noted), [])
})

test('宿の枠：宿を探す範囲は、その日の最後の場所と翌日の最初の場所のあいだ', () => {
  const schedule = [{ day: 1, pinId: null }, { day: 1, pinId: 'a' }, { day: 1, pinId: 'b' }, { day: 3, pinId: 'c' }]
  const at = { a: { lat: 36, lng: 138 }, b: { lat: 36.5, lng: 138.2 }, c: { lat: 37.5, lng: 139.2 }, inn: { lat: 30, lng: 130 } }
  const locationOf = (pinId) => at[pinId]
  const center = (bounds) => [(bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2]
  const near = (left, right) => left.every((value, index) => Math.abs(value - right[index]) < 1e-9)
  // 1 日目の最後（b）と、次に場所のある日の最初（c）のまん中。離れているので、両方が入る広さ
  const night1 = lodgingSearchBounds(schedule, 1, locationOf)
  assert.ok(near(center(night1), [37, 138.7]))
  assert.ok(night1.south <= 36.5 && night1.north >= 37.5 && night1.west <= 138.2 && night1.east >= 139.2)
  // その日に場所がなければ、それより前の最後の場所から
  assert.deepEqual(lodgingSearchBounds(schedule, 2, locationOf), night1)
  // 翌日の場所がまだなければ、その日の最後の場所のまわり（約 30 km 四方）
  const last = lodgingSearchBounds(schedule, 3, locationOf)
  assert.ok(near(center(last), [37.5, 139.2]))
  assert.ok(last.north - last.south < 0.5 && last.east - last.west < 0.5)
  // 近い 2 つのあいだでも、最小の広さは保つ
  const close = lodgingSearchBounds([{ day: 1, pinId: 'a' }, { day: 2, pinId: 'b' }], 1, (pinId) => (pinId === 'a' ? at.a : { lat: 36.02, lng: 138.02 }))
  assert.ok(near([close.north - close.south, close.east - close.west], [0.28, 0.34]))
  // 宿に決まった建物は、前後の場所に数えない
  const withInn = [{ day: 1, pinId: 'b' }, { day: 1, pinId: 'inn' }, { day: 2, pinId: 'c' }]
  assert.ok(near(center(lodgingSearchBounds(withInn, 1, locationOf, ['inn'])), [37, 138.7]))
  // 位置の分からない場所は飛ばす。場所が 1 つもなければ null（いま地図で映している範囲から探す）
  assert.ok(near(center(lodgingSearchBounds(schedule, 1, (pinId) => (pinId === 'a' ? at.a : undefined))), [36, 138]))
  assert.equal(lodgingSearchBounds([{ day: 1, pinId: null }], 1, locationOf), null)
})

test('宿の知らせ：宿の決まっていない夜のうち、閉じていないいちばん早い夜を出す', () => {
  assert.equal(hintNight([1, 2], []), 1)
  assert.equal(hintNight([1, 2], [1]), 2)
  assert.equal(hintNight([1, 2], [1, 2]), null)
  assert.equal(hintNight([], []), null)
  assert.deepEqual(closedNights('1,3'), [1, 3])
  assert.deepEqual(closedNights(null), [])
  assert.deepEqual(closedNights('x,0,2'), [2])
})

test('しおりの書き出し：宿に決まった建物の行に、宿の印が付く', () => {
  const trip = { title: '信州', startDate: '2026-11-21', endDate: '2026-11-22', origin: '' }
  const stop = (pinId) => ({ day: 1, time: '15:00', pinId, name: pinId, stayMinutes: 60, moveMinutesToNext: null })
  const places = [{ id: 'a', uid: 'u', wishId: 'w', category: 'farm' }, { id: 'inn', uid: 'u', wishId: 'w', category: 'lodging' }]
  const rows = (lodgingIds) => shioriBookDays(shioriBookOf(trip, [stop('a'), stop('inn')], places, [], [], lodgingIds))[0].rows.map((row) => row.lodging)
  assert.deepEqual(rows(['inn']), [false, true])
  // 種類が宿でも、泊まる夜の宿に決まっていなければ（日帰りの旅など）、ふつうの場所の行
  assert.deepEqual(rows(undefined), [false, false])
})

test('しおりの書き出し：宿を取らない夜は、その日の最後に書いた過ごし方を出し、行とカレンダーの予定は変えない（#553）', () => {
  const trip = { title: '信州', startDate: '2026-11-21', endDate: '2026-11-23', origin: '' }
  const at = (day, time, pinId) => ({ day, time, pinId, name: pinId, stayMinutes: 60, moveMinutesToNext: 30 })
  const schedule = [at(1, '10:00', 'a'), at(1, '15:00', 'b'), at(2, '09:00', 'c'), at(3, '09:00', 'd')]
  const places = ['a', 'b', 'c', 'd'].map((id) => ({ id, uid: 'u', wishId: 'w', category: 'farm' }))
  const plain = shioriBookOf(trip, schedule, places, [], [])
  const book = shioriBookOf(trip, schedule, places, [], [], [], [{ night: 1, note: '車中泊' }, { night: 2, note: null }])
  const days = shioriBookDays(book)
  // 書いた過ごし方は名前に、「宿は取らない」は下の 1 行に。書いていなければ「宿は取らない」だけ
  assert.deepEqual(days.map((day) => day.nightOff), [{ name: '車中泊', sub: '宿は取らない' }, { name: '宿は取らない', sub: null }, null])
  // 行は変えない（宿を取らない夜を足しても、前と同じ行）
  assert.deepEqual(days.map((day) => day.rows), shioriBookDays(plain).map((day) => day.rows))
  assert.equal('nightsOff' in plain, false)
  // Google カレンダーの予定（ID も）は、宿を取らない夜があっても同じ
  assert.deepEqual(calendarEvents(days, '信州', 'trip1'), calendarEvents(shioriBookDays(plain), '信州', 'trip1'))
})

// ---- しおりのゆとりと、空いた時間への提案（#520） ----
import { DAY_END_MINUTES as SLACK_DAY_END, clockOf, daySlacks } from '../web/src/entities/route/model/slack.ts'
import { isOpenFiller } from '../web/src/entities/pin/model/pins.ts'

test('ゆとり：最後の場所を出てから 19 時まで。宿の日は宿の前の場所から。予定のない日はまるごと（Functions の daySlacks と同じ決め）', () => {
  const route = {
    style: 'shortest',
    lodging: { 1: 'inn' },
    schedule: [
      { day: 1, time: '09:00', pinId: null, name: '東京駅 出発', stayMinutes: 0, moveMinutesToNext: 60 },
      { day: 1, time: '10:00', pinId: 'castle', name: '城', stayMinutes: 90, moveMinutesToNext: 20 },
      { day: 1, time: '11:50', pinId: 'inn', name: '宿', stayMinutes: 1270, moveMinutesToNext: 30 },
      { day: 2, time: '09:30', pinId: 'onsen', name: '温泉', stayMinutes: 120, moveMinutesToNext: null },
    ],
  }
  const slacks = daySlacks(route, 3)
  assert.deepEqual(slacks.map((slack) => [slack.day, clockOf(slack.from), slack.minutes, slack.empty]), [
    // 宿の日は、宿への移動（20 分）を引いて、宿に 19 時に着くまで（#602）
    [1, '11:30', SLACK_DAY_END - 20 - (11 * 60 + 30), false],
    [2, '11:30', SLACK_DAY_END - (11 * 60 + 30), false],
    [3, '09:00', 10 * 60, true],
  ])
  // ゆったり案は 10 時から
  assert.equal(daySlacks({ ...route, style: 'relaxed' }, 3)[2].from, 10 * 60)
})

test('空いた時間への提案：まだ無視も建築もされていない提案は全員の地図に出し、無視したものと建てたものは提案として扱わない', () => {
  const viewer = { uid: 'me', currentWishId: null, candidatesExpired: true, keepWishId: null }
  const filler = { uid: '', builtBy: null, status: 'candidate', wishId: '@filler', filler: { day: 2 } }
  assert.equal(isVisibleTo(filler, viewer), true)
  assert.equal(isOpenFiller(filler), true)
  assert.equal(isVisibleTo({ ...filler, filler: { day: 2, dismissed: true } }, viewer), false)
  assert.equal(isOpenFiller({ ...filler, status: 'building' }), false)
  // 建てたあとは、ふつうの建物として全員に出る
  assert.equal(isVisibleTo({ ...filler, status: 'done', uid: 'someone' }, viewer), true)
})

import { shownSlacks } from '../web/src/entities/route/model/slack.ts'

test('ゆとり：しおりに出すのは 30 分以上の空きだけ', () => {
  const route = { style: 'shortest', schedule: [{ day: 1, time: '17:00', pinId: 'a', name: 'a', stayMinutes: 105, moveMinutesToNext: null }] }
  // 1 日目は 18:45〜19:00 の 15 分なので出さず、2 日目はまるごと出す
  assert.deepEqual(shownSlacks(route, 2).map((slack) => slack.day), [2])
})

import { pinCounts } from '../web/src/entities/pin/model/pins.ts'

test('ピンの数：無視したゆとりへの提案は数えない（#520）', () => {
  const pins = [{ status: 'done' }, { status: 'candidate', filler: { day: 2 } }, { status: 'candidate', filler: { day: 2, dismissed: true } }]
  assert.deepEqual(pinCounts(pins), { buildings: 1, pins: 2 })
})

test('English selection survives navigation and localizes the meeting point in itinerary exports', () => {
  const script = `
    import assert from 'node:assert/strict'
    const stored = new Map()
    globalThis.window = {
      location: { search: '?lang=en' },
      localStorage: {
        getItem: key => stored.get(key),
        setItem: (key, value) => stored.set(key, value),
      },
    }
    const { appLanguage } = await import('./web/src/shared/lib/language.ts')
    assert.equal(appLanguage, 'en')
    assert.equal(stored.get('app-language'), 'en')
    const { shioriBookDays } = await import('./web/src/entities/trip/model/shioriBook.ts')
    const { calendarEvents } = await import('./web/src/features/export-calendar/lib/events.ts')
    const days = shioriBookDays({ startDate: '2026-11-23', stops: [{
      day: 1, time: '09:00', kind: 'origin', pinId: null,
      name: '東京駅 出発', stayMinutes: 0, moveMinutesToNext: 0,
    }] })
    assert.equal(days[0].rows[0].name, 'Tokyo Station')
    assert.equal(calendarEvents(days, 'Autumn trip', 'test')[0].summary, 'Meet and depart: Tokyo Station')
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  })
  assert.equal(result.status, 0, result.stderr)
})

import { eventDayNumber, eventIssueOf } from '../web/src/entities/route/model/events.ts'

test('しおりのイベントの行（#581）：開催日と違う日、前の予定から間に合わない、次の予定と重なる、を見分ける', () => {
  const event = { date: '2026-11-28', start: 19 * 60 + 30, end: 20 * 60 + 30 }
  assert.equal(eventDayNumber('2026-11-28', '2026-11-27'), 2)
  const row = (day, time, pinId, stayMinutes, moveMinutesToNext) => ({ day, time, pinId, name: pinId ?? '出発', stayMinutes, moveMinutesToNext })
  // 城を 17:00 に出て 40 分で着く。18:30 に間に合う
  const fits = [row(2, '09:00', null, 0, 20), row(2, '15:00', 'castle', 120, 40), row(2, '18:30', 'fire', 120, null)]
  assert.equal(eventIssueOf(fits, fits[2], event, '2026-11-27'), null)
  // 違う日
  assert.equal(eventIssueOf(fits, fits[2], event, '2026-11-28'), 'day')
  // 城を 18:00 に出ると間に合わない（Functions は城にいる時間を縮めきれない）
  const late = [row(2, '09:00', null, 0, 20), row(2, '18:00', 'castle', 0, 40), row(2, '18:30', 'fire', 120, null)]
  assert.equal(eventIssueOf(late, late[2], event, '2026-11-27'), 'late')
  // 花火を 20:30 に出て 30 分の所に、20:45 に着くことにしてある
  const overlap = [row(2, '18:30', 'fire', 120, 30), row(2, '20:45', 'soba', 60, null)]
  assert.equal(eventIssueOf(overlap, overlap[0], event, '2026-11-27'), 'overlap')
  // 次の行が翌日なら重ならない
  const nextDay = [row(2, '18:30', 'fire', 120, 30), row(3, '09:30', 'soba', 60, null)]
  assert.equal(eventIssueOf(nextDay, nextDay[0], event, '2026-11-27'), null)
  // 2 つあとの行の直した時刻が、花火の終わり（20:30）より前でも重なり（Functions と同じ決め）
  const later = [row(2, '18:30', 'fire', 120, 10), row(2, '20:40', 'cafe', 0, 10), row(2, '20:00', 'soba', 60, null)]
  assert.equal(eventIssueOf(later, later[0], event, '2026-11-27'), 'overlap')
})

// ---- 飛行機の区間を、地図で空港を経由する線にする（#620） ----
import { AIRPORT_LOCATIONS, AIRPORT_NAMES, flightLegPath, legAirports, legAirportStops } from '../web/src/entities/route/model/flightPath.ts'
import { AIRPORT_LOCATIONS as FUNCTIONS_AIRPORT_LOCATIONS } from '../functions/src/adapters/odpt.ts'

test('飛行機の区間の線は、便の空港を経由する', () => {
  const shinjuku = { lat: 35.69, lng: 139.7 }
  const naha = { lat: 26.21, lng: 127.68 }
  const flight = {
    minutes: 300,
    flight: { numbers: ['NH995'], airline: 'ANA', from: { code: 'HND', name: '羽田' }, to: { code: 'OKA', name: '那覇' }, dep: '10:00', arr: '12:45' },
    fetchedAt: '2026-11-22T00:00:00Z',
  }
  const path = flightLegPath(flight, shinjuku, naha)
  assert.deepEqual(path, {
    points: [shinjuku, AIRPORT_LOCATIONS.HND, AIRPORT_LOCATIONS.OKA, naha],
    air: [1, 2],
    // 空港は、しおりの場所として名前と便の発着の時刻を持つ
    airports: {
      from: { code: 'HND', name: '羽田空港', location: AIRPORT_LOCATIONS.HND, time: '10:00' },
      to: { code: 'OKA', name: '那覇空港', location: AIRPORT_LOCATIONS.OKA, time: '12:45' },
    },
  })
  // 便の空港が、区間の両端に最も近い空港でなくても、便の空港を使う（成田発の便）
  const narita = { ...flight, flight: { ...flight.flight, from: { code: 'NRT', name: '成田' } } }
  assert.deepEqual(legAirports(narita, shinjuku, naha), { from: AIRPORT_LOCATIONS.NRT, to: AIRPORT_LOCATIONS.OKA })
})

test('便のない飛行機の区間は、最終便の空港か、両端に最も近い空港を経由する', () => {
  const sapporo = { lat: 43.07, lng: 141.35 }
  const fukuoka = { lat: 33.59, lng: 130.42 }
  const lastFlight = { airline: 'JAL', number: 'JL3511', from: { code: 'CTS', name: '新千歳' }, to: { code: 'FUK', name: '福岡' }, dep: '17:00', arriveAirportBy: '16:00' }
  assert.deepEqual(legAirports({ minutes: 400, flight: null, fetchedAt: null, lastFlight }, sapporo, fukuoka), { from: AIRPORT_LOCATIONS.CTS, to: AIRPORT_LOCATIONS.FUK })
  // 時刻表がない目安：札幌に最も近いのは新千歳、福岡（博多）に最も近いのは福岡空港
  assert.deepEqual(legAirports({ minutes: 400, flight: null, fetchedAt: null }, sapporo, fukuoka), { from: AIRPORT_LOCATIONS.CTS, to: AIRPORT_LOCATIONS.FUK })
  // 便の情報がまだない区間（変えたばかり）も、最も近い空港
  assert.deepEqual(legAirports(undefined, sapporo, fukuoka), { from: AIRPORT_LOCATIONS.CTS, to: AIRPORT_LOCATIONS.FUK })
})

test('空港が分からない、乗る空港と降りる空港が同じ飛行機の区間は、まっすぐ結ぶ', () => {
  // 太平洋の上（150 km 以内に空港がない）
  assert.equal(flightLegPath(undefined, { lat: 30, lng: 150 }, { lat: 35.69, lng: 139.7 }), null)
  // 両端の最も近い空港が同じ（羽田）
  assert.equal(flightLegPath(undefined, { lat: 35.69, lng: 139.7 }, { lat: 35.45, lng: 139.64 }), null)
  // 表にない空港の便
  const unknown = { minutes: 200, flight: { numbers: ['X1'], airline: 'X', from: { code: 'ZZZ', name: '?' }, to: { code: 'OKA', name: '那覇' }, dep: '10:00', arr: '12:00' }, fetchedAt: null }
  assert.equal(flightLegPath(unknown, { lat: 35.69, lng: 139.7 }, { lat: 26.21, lng: 127.68 }), null)
})

test('空港の名前は表から引き、便のない目安の区間では時刻を空ける', () => {
  const stops = legAirportStops({ minutes: 400, flight: null, fetchedAt: null }, { lat: 43.07, lng: 141.35 }, { lat: 33.59, lng: 130.42 })
  assert.deepEqual(stops && [stops.from.name, stops.from.time, stops.to.name, stops.to.time], ['新千歳空港', null, '福岡空港', null])
  // 画面の表と Functions の位置の表は、同じ空港を持つ
  assert.deepEqual(Object.keys(AIRPORT_NAMES).sort(), Object.keys(AIRPORT_LOCATIONS).sort())
})

test('再生では、飛行機の区間を空港で区切り、空港に着くたびに止まる', () => {
  const road = (length, via) => ({ length, via })
  const toAirport = road(20_000, '羽田空港')
  const fly = road(1_500_000, '那覇空港')
  const fromAirport = road(10_000)
  // 0 番目の場所 → 飛行機の区間（空港で 3 つに区切る）→ 1 番目の場所
  const steps = tourSteps(2, [[toAirport, fly, fromAirport]], null, () => road(0), false)
  assert.deepEqual(
    steps.map((step) => [step.kind, step.index, step.leg.length, Boolean(step.via)]),
    [
      ['arrive', 0, 20_000, false],
      ['drive', 1, 20_000, false],
      ['arrive', 1, 20_000, true],
      ['drive', 1, 1_500_000, false],
      ['arrive', 1, 1_500_000, true],
      ['drive', 1, 10_000, false],
      ['arrive', 1, 10_000, false],
    ],
  )
  // 空港では、建物と同じだけ止まる。走る時間は区切った道ごと（寄り具合も道ごとに決まる）
  assert.ok(steps.filter((step) => step.via).every((step) => step.ms === ARRIVE_MS))
  assert.equal(steps[1].ms, driveMs(20_000))
  // 集合場所からの区間も同じように区切る
  const fromOrigin = tourSteps(1, [], [toAirport, fly], () => road(0), false)
  assert.deepEqual(fromOrigin.map((step) => [step.kind, Boolean(step.via)]), [['drive', false], ['arrive', true], ['drive', false], ['arrive', false]])
})

test('道の上の車の位置は、区間の始まりからの道のりも返す（空港の前後で乗り物を替えるのに使う）', () => {
  const leg = makeLeg([{ lat: 35, lng: 139 }, { lat: 35, lng: 139.5 }, { lat: 35, lng: 140 }])
  assert.equal(placeAlong(leg, 0).distance, 0)
  assert.ok(Math.abs(placeAlong(leg, 0.5).distance - leg.length / 2) < 1)
  assert.ok(Math.abs(placeAlong(leg, 1).distance - leg.length) < 1)
  // 詰めた道のりは、端から数える
  assert.ok(Math.abs(placeAlong(leg, 0, 1000).distance - 1000) < 1)
  assert.equal(placeAlong(makeLeg([{ lat: 35, lng: 139 }]), 0.5).distance, 0)
})

test('旅の再生：空港を経由する区間は、空港まで地上の乗り物で走り、空港どうしを飛び、空港から地上で着く。空港が近くても地上を走る', () => {
  // 東京駅 → 羽田（約 15km）→ 新千歳 → 定山渓温泉（約 47km）
  const tokyo = { lat: 35.681, lng: 139.767 }
  const haneda = AIRPORT_LOCATIONS.HND
  const chitose = AIRPORT_LOCATIONS.CTS
  const jozankei = { lat: 42.968, lng: 141.163 }
  const leg = makeLeg([tokyo, haneda, chitose, jozankei])
  const air = { from: leg.distances[1], to: leg.distances[2] }
  // 遠くへ飛ぶ区間の寄り具合では、詰め（建物の縁で止まる長さ）が 30km を超え、東京駅から羽田より長い
  const trim = 35_000
  assert.ok(air.from < trim)
  // 走り出しは地上（空港の手前）。詰めは地上の区間の半分までに抑える
  const start = tourMotion(leg, 0, trim, air)
  assert.equal(start.onGround, true)
  assert.ok(start.place.distance > 0 && start.place.distance <= air.from / 2 + 1)
  // 時間の 15% のあいだは地上を走り、羽田に近づく
  assert.equal(tourMotion(leg, 0.1, trim, air).onGround, true)
  assert.ok(tourMotion(leg, 0.1, trim, air).place.distance < air.from)
  // 真ん中は空。flown は飛ぶところの進み具合
  const middle = tourMotion(leg, 0.5, trim, air)
  assert.equal(middle.onGround, false)
  assert.ok(middle.place.distance > air.from && middle.place.distance < air.to)
  assert.ok(middle.flown > 0.3 && middle.flown < 0.7)
  // 終わりの近くは、新千歳から地上を走り、定山渓温泉の手前（詰めた所）で止まる
  const near = tourMotion(leg, 0.95, trim, air)
  assert.equal(near.onGround, true)
  assert.ok(near.place.distance > air.to)
  const end = tourMotion(leg, 1, trim, air)
  assert.equal(end.onGround, true)
  assert.ok(Math.abs(end.place.distance - (leg.length - Math.min(trim, (leg.length - air.to) / 2))) < 1)
  // 地上を走る向きは、空港への道の向き（東京駅から羽田は南へ。札幌の向きに引きずられない）
  const heading = tourMotion(leg, 0.05, trim, air).place.heading
  assert.ok(heading > 150 && heading < 240, `heading ${heading}`)
  // 進み具合が増えると、道のりも減らない
  let last = -1
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const distance = tourMotion(leg, p, trim, air).place.distance
    assert.ok(distance >= last - 1e-6)
    last = distance
  }
})

test('旅の再生：空港を経由しない区間は、今までどおり区間の全部を 1 つの乗り物で走る', () => {
  const leg = makeLeg([{ lat: 35, lng: 139 }, { lat: 35, lng: 140 }])
  for (const p of [0, 0.3, 1]) {
    const motion = tourMotion(leg, p, 1000)
    assert.deepEqual(motion.place, placeAlong(leg, p, 1000))
    assert.equal(motion.onGround, false)
    assert.equal(motion.flown, p)
  }
  // 空港が出発地と同じ所（地上の区間がない）なら、走り出しから飛ぶ
  const direct = tourMotion(leg, 0, 1000, { from: 0, to: leg.length })
  assert.equal(direct.onGround, false)
  assert.equal(direct.flown, 0)
})

test('空港の位置の表は、Functions 側の表と同じ', () => {
  assert.deepEqual(AIRPORT_LOCATIONS, FUNCTIONS_AIRPORT_LOCATIONS)
})

test('カレンダーへの書き出し：場所から場所への移動も予定にし、ゆとりの時間には入れない。日をまたぐ移動は次の日の場所に着く時刻で終える', () => {
  const stop = (day, time, pinId, name, stayMinutes, moveMinutesToNext, extra = {}) => ({ day, time, pinId, name, stayMinutes, moveMinutesToNext, category: null, wisher: null, wishText: null, ...extra })
  const book = {
    startDate: '2026-12-30',
    stops: [
      stop(1, '09:00', null, '新宿駅 出発', 0, 100, { meetTime: '08:45' }),
      // 10:40 に着いて 90 分。12:10 に出て 30 分で着くが、次は 13:00 から（12:40〜13:00 はゆとり）
      stop(1, '10:40', 'p1', '美ヶ原高原', 90, 30),
      stop(1, '13:00', 'p2', '松本城', 60, 45),
      // その日の最後の場所から、次の日の最初の場所へ（次の日の始まりに出る）
      stop(2, '09:45', 'p3', '白骨温泉', 120, 20, { kind: 'lodging' }),
      // 宿は次の朝に出る（宿にいる時間が、次の朝 9:00 まで）
      stop(3, '09:20', 'p4', '上高地', 60, null),
    ],
  }
  // 宿の行：2 日目の 9:45 に着き、3 日目の 9:00 まで（23 時間 15 分）
  book.stops[3].stayMinutes = 23 * 60 + 15
  const events = calendarEvents(shioriBookDays(book), '冬の信州', 'trip-1')
  assert.deepEqual(events.map((event) => [event.kind, event.summary, event.start.dateTime, event.end.dateTime]), [
    ['stay', '新宿駅に集合・出発', '2026-12-30T08:45:00', '2026-12-30T09:00:00'],
    ['move', '移動：新宿駅 → 美ヶ原高原', '2026-12-30T09:00:00', '2026-12-30T10:40:00'],
    ['stay', '美ヶ原高原', '2026-12-30T10:40:00', '2026-12-30T12:10:00'],
    // 12:10 に出て 30 分。12:40〜13:00 のゆとりには何も入れない
    ['move', '移動：美ヶ原高原 → 松本城', '2026-12-30T12:10:00', '2026-12-30T12:40:00'],
    ['stay', '松本城', '2026-12-30T13:00:00', '2026-12-30T14:00:00'],
    // 次の日の最初の場所へは、着く時刻（9:45）で終える
    ['move', '移動：松本城 → 白骨温泉', '2026-12-31T09:00:00', '2026-12-31T09:45:00'],
    ['stay', '白骨温泉', '2026-12-31T09:45:00', '2027-01-01T09:00:00'],
    // 宿は次の朝に出る
    ['move', '移動：白骨温泉 → 上高地', '2027-01-01T09:00:00', '2027-01-01T09:20:00'],
    ['stay', '上高地', '2027-01-01T09:20:00', '2027-01-01T10:20:00'],
  ])
  // 移動の予定の ID も Calendar に使える字で、場所の予定の ID と重ならない
  const ids = events.map((event) => event.id)
  for (const id of ids) assert.match(id, /^[0-9a-v]{5,1024}$/)
  assert.equal(new Set(ids).size, ids.length)
  // 移動が次の場所の時刻にかかるときは、次の場所の時刻で切る。移動の長さが分からない・0 分なら入れない
  const tight = calendarEvents(shioriBookDays({ startDate: '2026-12-30', stops: [stop(1, '10:00', 'p1', 'A', 60, 40), stop(1, '11:20', 'p2', 'B', 30, 0), stop(1, '12:00', 'p3', 'C', 30, null)] }), '旅', 'trip-1')
  assert.deepEqual(tight.filter((event) => event.kind === 'move').map((event) => [event.startTime, event.endTime]), [['11:00', '11:20']])
})

import { ALL_PREFECTURES as allPrefectures, provisionalTripTitle, REGION_PREFECTURES as regionPrefectures } from '../web/src/entities/trip/model/regions.ts'

test('旅の仮の名前：選んだ場所から作る。旅の名前は確定するときに決める', () => {
  const prefectures = regionPrefectures
  const all = allPrefectures
  assert.equal(provisionalTripTitle([...prefectures.hokuriku]), '北陸の旅')
  assert.equal(provisionalTripTitle(['長野県', '石川県']), '長野県・石川県の旅')
  assert.equal(provisionalTripTitle([...prefectures.hokuriku, '長野県', '北海道']), '北海道ほかの旅')
  assert.equal(provisionalTripTitle([...all]), '全国の旅')
  assert.equal(provisionalTripTitle([]), '新しい旅')
})

import { areaMinZoom, viewForPoints } from '../web/src/widgets/trip-map/lib/mercator.ts'

test('旅の地図の引ける限界：エリアが帯とシートを除いた所に収まる拡大の度合いより、0.5 段引いたところ', () => {
  const corners = [{ lat: 37.9, lng: 135.9 }, { lat: 35.3, lng: 139.9 }]
  const size = { width: 390, height: 844 }
  const padding = { top: 96, right: 16, bottom: 316, left: 16 }
  const fit = viewForPoints(corners, size, padding, 16).zoom
  assert.equal(areaMinZoom(corners, size, padding), fit - 0.5)
  // 限界の拡大の度合いでも、エリアの全体が帯とシートの内側に収まる
  assert.ok(areaMinZoom(corners, size, padding) < fit)
  // 点が足りなければ限らない。日本全体より引くことはない
  assert.equal(areaMinZoom([], size, padding), null)
  assert.ok(areaMinZoom([{ lat: 45.5, lng: 141 }, { lat: 24.3, lng: 123.8 }], size, padding) >= 4)
})

test('しおりの天気のアイコン：着く時刻の 6 時間の区切りの天気を使い、区切りがなければ 1 日の天気', () => {
  const row = { sky: 'rain', skies: [{ hour: 12, sky: 'sunny' }, { hour: 18, sky: 'rain' }] }
  assert.equal(skyAtTime(row, '13:30'), 'sunny')
  assert.equal(skyAtTime(row, '18:00'), 'rain')
  assert.equal(skyAtTime(row, '09:00'), 'rain', '今日の朝など、区切りがない時刻は 1 日の天気')
  assert.equal(skyAtTime(row, ''), 'rain', '時刻がない行も 1 日の天気')
  assert.equal(skyAtTime({ sky: 'snow' }, '10:00'), 'snow')
  assert.equal(skyAtTime({}, '10:00'), null, '天気を返さない前の版の Functions なら出さない')
})

test('宿の枠：前の夜と同じ宿にできるのは、前の夜の宿が建物で決まっていて、その行がしおりにあるときだけ（#642）', () => {
  const stop = (day, pinId, name, stopId) => ({ day, time: '10:00', pinId, name, stayMinutes: 60, moveMinutesToNext: 10, ...(stopId ? { stopId } : {}) })
  const schedule = [stop(1, 'a', '松本城'), stop(1, 'inn', '浅間温泉の宿'), stop(2, 'b', '上高地'), stop(2, 'inn', '浅間温泉の宿', 'inn~2'), stop(3, 'c', '安曇野')]
  const nights = lodgingNights({ schedule, lodging: { 1: 'inn', 2: 'inn~2' } }, 3)
  assert.deepEqual(previousLodging(nights, schedule, 2), { name: '浅間温泉の宿' })
  // 前の夜が複製した行の宿でも、その名前
  assert.deepEqual(previousLodging(nights, schedule, 3), { name: '浅間温泉の宿' })
  // 1 日目の夜、前の夜が決まっていない、宿を取らない、行がない
  assert.equal(previousLodging(nights, schedule, 1), null)
  assert.equal(previousLodging(lodgingNights({ schedule, lodging: {} }, 3), schedule, 2), null)
  assert.equal(previousLodging(lodgingNights({ schedule, lodging: { 1: LODGING_SKIP } }, 3), schedule, 2), null)
  assert.equal(previousLodging(lodgingNights({ schedule, lodging: { 1: 'gone' } }, 3), schedule, 2), null)
})

import { goalOf } from '../web/src/pages/trip-create/model/quizAnswers.ts'

test('帰る場所：打ち変えるまでは出発地と同じ。打ち変えたらその場所（Takana の依頼、2026-11-22）', () => {
  const info = { title: '', startDate: '2026-11-28', endDate: null, origin: ' 東京駅 ' }
  assert.equal(goalOf({ info, goal: null }), '東京駅')
  assert.equal(goalOf({ info, goal: '新宿駅 ' }), '新宿駅')
  assert.equal(goalOf({ info, goal: '' }), '')
})

import { isWeatherCacheFresh, mergeForecasts, parseForecastArchive, parseWeatherCache, WEATHER_CACHE_MS, weatherCacheRemaining } from '../web/src/features/shiori-weather/model/weatherCache.ts'

test('決まったしおりの天気：覚えた予報は 1 日たつまで使い、たったら取り直す。壊れたものは使わない', () => {
  const now = Date.parse('2026-11-22T12:00:00+09:00')
  const cache = { fetchedAt: now - 60_000, forecasts: [{ prefecture: '石川県', date: '2026-11-23', area: '加賀', forecast: '晴れ' }] }
  assert.deepEqual(parseWeatherCache(JSON.stringify(cache)), cache)
  assert.equal(parseWeatherCache(null), null)
  assert.equal(parseWeatherCache('{'), null)
  assert.equal(parseWeatherCache(JSON.stringify({ fetchedAt: 'x', forecasts: [] })), null)
  assert.equal(isWeatherCacheFresh(cache, now), true)
  assert.equal(weatherCacheRemaining(cache, now), WEATHER_CACHE_MS - 60_000)
  assert.equal(isWeatherCacheFresh({ ...cache, fetchedAt: now - WEATHER_CACHE_MS }, now), false)
  assert.equal(isWeatherCacheFresh({ ...cache, fetchedAt: now + 60_000 }, now), false)
  assert.equal(isWeatherCacheFresh(null, now), false)
})

test('決まったしおりの天気：取った予報を積み、過ぎた日の予報も残す。同じ府県・日・予報区は新しいもの（Takana の依頼、2026-11-23）', () => {
  const past = { prefecture: '長野県', date: '2026-11-21', area: '北部', forecast: '晴れ', sky: 'sunny' }
  const old = { prefecture: '長野県', date: '2026-11-23', area: '北部', forecast: 'くもり', sky: 'cloudy' }
  const fresh = { prefecture: '長野県', date: '2026-11-23', area: '北部', forecast: '雨', sky: 'rain' }
  const next = { prefecture: '長野県', date: '2026-11-24', area: '北部', forecast: '雪', sky: 'snow' }
  assert.deepEqual(mergeForecasts([past, old], [fresh, next]), [past, fresh, next])
  assert.deepEqual(parseForecastArchive(JSON.stringify([past, { date: 1 }, null])), [past])
  assert.deepEqual(parseForecastArchive('{'), [])
  assert.deepEqual(parseForecastArchive(null), [])
})

test('旅の地図の画面：地図だけの画面（?view=map）は確定した旅だけ。確定していなければ、読み込み後に地図のしおりへ送る', () => {
  assert.deepEqual(tripMapView('map', true, true), { screen: 'map-only', redirect: null })
  assert.deepEqual(tripMapView('map', false, true), { screen: 'shiori', redirect: 'shiori' })
  assert.deepEqual(tripMapView('map', false, false), { screen: 'shiori', redirect: null })
  assert.deepEqual(tripMapView('shiori', true, true), { screen: 'shiori', redirect: null })
  assert.deepEqual(tripMapView(null, true, true), { screen: 'map', redirect: null })
  assert.deepEqual(tripMapView('other', false, true), { screen: 'map', redirect: null })
})

test('旅の再生が終わったら、地図だけの画面では地図だけのまま、ほかではしおりに戻る', () => {
  assert.equal(tourEndView('map-only'), 'map')
  assert.equal(tourEndView('shiori'), 'shiori')
})

import { reachKm, rollChoices } from '../web/src/pages/trip-create/model/reach.ts'
import { distanceKm as reachDistance } from '../web/src/entities/trip/model/distance.ts'
import { REGION_PREFECTURES as REACH_REGIONS } from '../web/src/entities/trip/model/regions.ts'
import { PREFECTURES as REACH_POINTS } from '../web/src/widgets/trip-map/lib/viewLabel.ts'

/** サイコロで選べる県（全部の地方がまだ選んでいないとき） */
function reachable(from, mode, nights) {
  const regions = Object.entries(REACH_REGIONS).map(([id, prefectures]) => ({ id, prefectures }))
  return rollChoices({ regions, from, mode, nights, prefectures: REACH_POINTS, distance: reachDistance }).flatMap((choice) => choice.prefectures)
}

test('サイコロ：車で東京から 1 泊なら、関東と伊豆のあたりまで', () => {
  const tokyo = { lat: 35.68124, lng: 139.76712 }
  const names = reachable(tokyo, 'car', 1)
  for (const name of ['東京都', '神奈川県', '静岡県', '山梨県', '栃木県']) assert.ok(names.includes(name), name)
  for (const name of ['大阪府', '宮城県', '北海道', '福岡県', '沖縄県']) assert.ok(!names.includes(name), name)
})

test('サイコロ：車で大阪から 4 泊なら、関東や九州の北まで入り、東北と南九州は入らない', () => {
  const osaka = { lat: 34.70249, lng: 135.49595 }
  const names = reachable(osaka, 'car', 4)
  for (const name of ['東京都', '福岡県', '佐賀県', '大分県']) assert.ok(names.includes(name), name)
  for (const name of ['宮城県', '鹿児島県', '北海道', '沖縄県']) assert.ok(!names.includes(name), name)
})

test('サイコロ：電車・バスは車より遠くまで。1 泊で東京から関西まで', () => {
  const tokyo = { lat: 35.68124, lng: 139.76712 }
  assert.ok(reachKm('transit', 1) > reachKm('car', 1))
  const names = reachable(tokyo, 'transit', 1)
  for (const name of ['大阪府', '京都府', '宮城県']) assert.ok(names.includes(name), name)
  for (const name of ['福岡県', '北海道', '沖縄県']) assert.ok(!names.includes(name), name)
})

test('サイコロ：飛行機はどこでもよいが、近すぎる県は選ばない', () => {
  const tokyo = { lat: 35.68124, lng: 139.76712 }
  const names = reachable(tokyo, 'plane', 0)
  for (const name of ['北海道', '沖縄県', '福岡県', '大阪府']) assert.ok(names.includes(name), name)
  for (const name of ['東京都', '神奈川県']) assert.ok(!names.includes(name), name)
})

test('サイコロ：出発地か乗り物が分からなければしぼらない。範囲に何もなければ、いちばん近い県', () => {
  const regions = [{ id: 'okinawa', prefectures: ['沖縄県'] }, { id: 'hokkaido', prefectures: ['北海道'] }]
  const all = rollChoices({ regions, from: null, mode: 'car', nights: 0, prefectures: REACH_POINTS, distance: reachDistance })
  assert.deepEqual(all.map((choice) => choice.region), ['okinawa', 'hokkaido'])
  const tokyo = { lat: 35.68124, lng: 139.76712 }
  const nearest = rollChoices({ regions, from: tokyo, mode: 'car', nights: 0, prefectures: REACH_POINTS, distance: reachDistance })
  assert.deepEqual(nearest, [{ region: 'hokkaido', prefectures: ['北海道'] }])
})

test('宿の Booking.com の検索：宿の名前と地名で探し、記号を URL の中で崩さない（#705）', () => {
  assert.equal(bookingSearchUrl('湯元 旅館', '箱根'), 'https://www.booking.com/searchresults.ja.html?ss=%E6%B9%AF%E5%85%83%20%E6%97%85%E9%A4%A8%20%E7%AE%B1%E6%A0%B9')
  assert.equal(bookingSearchUrl('A&B ホテル', null), `https://www.booking.com/searchresults.ja.html?ss=${encodeURIComponent('A&B ホテル')}`)
  assert.ok(!bookingSearchUrl('a?b#c', '').includes('#'), '記号をそのまま入れた')
})

import { BUILD_STALE_MS, staleBuildIds } from '../web/src/entities/pin/model/pins.ts'
import { isWishSearching, SEARCH_TIMEOUT_MS } from '../web/src/pages/trip-map/model/searching.ts'
test('工事中のまま止まったピン：引き受けてから 10 分たった工事中だけを、失敗として見せる（#727）', () => {
  const at = (ms) => ({ toMillis: () => ms })
  const now = new Date(1_000_000_000)
  const pins = [
    { id: 'fresh', status: 'building', buildStartedAt: at(now.getTime() - 60_000), updatedAt: at(0) },
    { id: 'stuck', status: 'building', buildStartedAt: at(now.getTime() - BUILD_STALE_MS - 1), updatedAt: at(0) },
    // まだ引き受けられていない工事中は、最後に書いた時刻で見る
    { id: 'unclaimed', status: 'building', buildStartedAt: null, updatedAt: at(now.getTime() - BUILD_STALE_MS - 1) },
    { id: 'done', status: 'done', buildStartedAt: at(0), updatedAt: at(0) },
    { id: 'no-time', status: 'building', buildStartedAt: null, updatedAt: null },
  ]
  assert.equal(BUILD_STALE_MS, 600_000)
  assert.deepEqual(staleBuildIds(pins, now), ['stuck', 'unclaimed'])
})

test('宿さがし・お店さがし：書いてから 330 秒たった探し途中は、終わったとみなしてボタンを戻す（#729）', () => {
  const now = new Date(1_000_000_000)
  const wish = (status, agoMs) => ({ status, createdAt: agoMs === null ? null : { toDate: () => new Date(now.getTime() - agoMs) } })
  assert.equal(isWishSearching(wish('pending', 10_000), now), true)
  assert.equal(isWishSearching(wish('searching', SEARCH_TIMEOUT_MS - 1), now), true)
  assert.equal(isWishSearching(wish('searching', SEARCH_TIMEOUT_MS), now), false)
  assert.equal(isWishSearching(wish('done', 0), now), false)
  assert.equal(isWishSearching(wish('failed', 0), now), false)
  // 書いた直後でサーバーの時刻がまだないときは、探している途中
  assert.equal(isWishSearching(wish('pending', null), now), true)
})
