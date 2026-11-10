// web の純粋な関数を、ブラウザなしで確かめる。web にはテストの道具を入れていないので、
// Node 24 の型の取り除きで .ts をそのまま読む（型だけの書き方の .ts に限る）。
// 使い方：node --test scripts/web.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import './sound.test.mjs'
import { swipeTarget } from '../web/src/shared/lib/swipe.ts'
import { settledAfterAnimation, sheetPhase } from '../web/src/shared/lib/sheetPhase.ts'
import { ARRIVE_MS, DRIVE_MAX_MS, DRIVE_MIN_MS, driveMs, easeInOut, tourSteps } from '../web/src/pages/trip-map/model/tour.ts'
import { bearing, legZoom, makeLeg, placeAlong } from '../web/src/widgets/trip-map/lib/tourPath.ts'

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


// 候補のピンを誰の地図に出すか（PR #49 のレビューの指摘で足した）
import { CANDIDATE_VISIBLE_MS, candidatesExpireAt, isVisibleTo } from '../web/src/entities/pin/model/pins.ts'

const viewer = (overrides = {}) => ({ uid: 'me', currentWishId: 'w2', candidatesExpired: false, keepWishId: null, ...overrides })
const pinOf = (overrides = {}) => ({ uid: 'me', builtBy: null, status: 'candidate', wishId: 'w2', ...overrides })

test('ピンを出す人：工事中と完成の建物は、誰の地図にも出す', () => {
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'building' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'done' }), viewer({ candidatesExpired: true })), true)
})

test('ピンを出す人：建築に失敗したピンは、希望を書いた人と建てようとした人にだけ出す', () => {
  assert.equal(isVisibleTo(pinOf({ status: 'failed' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'failed', builtBy: 'me' }), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other', status: 'failed', builtBy: 'third' }), viewer()), false)
})

test('ピンを出す人：候補は、希望を書いた本人の、いちばん新しい検索のぶんを 5 分だけ出す', () => {
  assert.equal(isVisibleTo(pinOf(), viewer()), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other' }), viewer()), false)
  assert.equal(isVisibleTo(pinOf({ wishId: 'w1' }), viewer()), false)
  assert.equal(isVisibleTo(pinOf(), viewer({ candidatesExpired: true })), false)
  assert.equal(isVisibleTo(pinOf(), viewer({ currentWishId: null })), false)
})

test('ピンを出す人：場所カードで見ている途中の検索の候補は、5 分を過ぎても、前の検索でも消さない', () => {
  assert.equal(isVisibleTo(pinOf(), viewer({ candidatesExpired: true, keepWishId: 'w2' })), true)
  assert.equal(isVisibleTo(pinOf({ wishId: 'w1' }), viewer({ keepWishId: 'w1' })), true)
  assert.equal(isVisibleTo(pinOf({ uid: 'other' }), viewer({ keepWishId: 'w2' })), false)
})

test('候補が消える時刻：その検索でいちばん遅く立った候補から 5 分後。まだ立っていなければ null', () => {
  const at = (ms) => ({ toMillis: () => ms })
  const pins = [
    { wishId: 'w2', createdAt: at(1_000) },
    { wishId: 'w2', createdAt: at(3_000) },
    { wishId: 'w1', createdAt: at(9_000) },
    { wishId: 'w2', createdAt: null },
  ]
  assert.equal(candidatesExpireAt(pins, 'w2'), 3_000 + CANDIDATE_VISIBLE_MS)
  assert.equal(candidatesExpireAt(pins, 'w3'), null)
  assert.equal(candidatesExpireAt([{ wishId: 'w2', createdAt: null }], 'w2'), null)
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
