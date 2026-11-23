import { type DocumentReference, FieldValue } from 'firebase-admin/firestore'
import type { PinEvent } from '../../domain/event'
import { decideAiGate } from '../../domain/geminiBudget'
import { type Pin, placeQuery } from '../../domain/pin'
import { type Route, SHIORI_ROUTE_ID } from '../../domain/route'
import { allowedPrefectures } from '../../domain/region'
import { tripDays } from '../../domain/routePlan'
import type { Trip } from '../../domain/trip'
import { parseMealKey } from '../../domain/meal'
import { groundMode, travelModeOf } from '../../domain/travelMode'
import { lodgingNightOf, mealSlotOf, type Wish } from '../../domain/wish'
import type { GeminiPermit } from '../../ports/gemini'
import { candidatePinId, detectArea, LODGING_POOL, MAX_CANDIDATES, pickCandidates, wantsLodging } from './logic'
import { acceptLodging, clockText, hotelArriveBy, LODGING_CHECKS_MAX, type LodgingContext, lodgingContext, rankLodgings } from './logic/lodgingPlan'
import { searchEvents, wantsEvent } from './logic/events'
import type { SuggestPlacesPorts } from './ports'
import type { LodgingPromptContext, SuggestedPlace } from './types'
import { suggestPlacesTask } from './prompt'

export interface SuggestPlacesOptions {
  /**
   * 今の Gemini の経路に費用がかかる（vertex）か。true なら、呼ぶ前に関所（aiGate）を通し、
   * 通ったときだけ印（GeminiPermit）を付ける。false（stub、agy）なら関所は見ない
   */
  guarded: boolean
}

/**
 * 希望 1 つから、候補のピンを立てる。読む → logic で決める → 書く。
 *
 * 同じイベントが 2 回届いても、ピンが 2 倍にならないようにしてある：
 * - 最初にトランザクションで status を pending → searching にする。2 回目は pending ではないので何もしない
 * - ピンの ID は「希望の ID ＋ 順番」で決まるので、同じ内容で書き直しても増えない
 *
 * ピンの持ち主（uid）は、書く直前に読み直した希望の uid にする（途中で Google アカウントへ切り替わっても、今の自分のものになる）
 *
 * 費用：経路が vertex のときは、希望を書いた人が合言葉を通していて（aiAccess/{uid}）、Flash の累計が上限の中
 * （usage/flash）のときだけ印を付ける。印がなければ呼び出し口が固定の応答に戻す（design-principles の cost/gemini-guarded）
 */
export async function suggestPlacesForWish(
  ports: SuggestPlacesPorts,
  tripId: string,
  wishId: string,
  options: SuggestPlacesOptions = { guarded: false },
): Promise<void> {
  const { db, gemini } = ports
  const trip = db.collection('trips').doc(tripId)
  const wishRef = trip.collection('wishes').doc(wishId)

  // Gemini を呼ぶ前に「自分が引き受けた」と書く
  const wish = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(wishRef)
    const data = snapshot.data() as Wish | undefined
    if (!data || data.status !== 'pending') return null
    tx.update(wishRef, { status: 'searching' })
    return data
  })
  if (!wish) return

  try {
    const existing = await trip.collection('pins').select('name').get()
    const exclude = existing.docs.map((pin) => String(pin.get('name')))
    // 旅を作った人が選んだ地方（県まで絞ったときはその県）の中にだけ、ピンを立てる
    // （#373。すべて選んでいるか、地方のない旅では絞らない）
    const tripData = (await trip.get()).data() as Trip | undefined
    const allowed = allowedPrefectures(tripData)
    const prefectures = allowed ? [...allowed] : null

    // 宿さがしか。しおりの「宿を探す」から書いた希望（lodgingNight）か、文に宿の言葉がある
    const lodgingNight = lodgingNightOf(wish)
    // ごはんのお店さがしか。しおりのごはんの枠の「お店を探す」から書いた希望（mealSlot）。宿さがしより先に見る
    const mealSlot = mealSlotOf(wish)
    const meal = mealSlot ? parseMealKey(mealSlot)?.meal : undefined
    const lodging = !meal && (lodgingNight !== null || wantsLodging(wish.text))
    // 時刻が決まったイベント（花火大会、見学会）さがしか。イベントは Gemini に聞かず、旅の日程のあいだに開催される見本の一覧から探す（#581）
    const eventKinds = lodging || meal || !tripData ? null : wantsEvent(wish.text)
    let places: SuggestedPlace[]
    let events: (PinEvent | undefined)[] = []
    let provider: Pin['suggestedBy']
    if (eventKinds && tripData) {
      const found = searchEvents({
        kinds: eventKinds,
        bounds: wish.bounds,
        prefectures,
        named: detectArea(wish.text).prefs,
        exclude,
        startDate: tripData.startDate,
        days: tripDays(tripData.startDate, tripData.endDate),
      })
      places = found.map((item) => item.place)
      events = found.map((item) => item.event)
      provider = 'stub'
    } else {
      // 宿さがしは、しおりからその夜の様子（最後の場所、翌日の場所、移動）を読み、泊まる側のまわりを探す（Takana の決定、2026-11-22）
      const night = lodging && lodgingNight !== null && tripData ? await nightContext(trip, tripData, lodgingNight) : null
      const permit = options.guarded ? await permitFor(ports, wish.uid, wishId) : undefined
      const result = await gemini.run(
        suggestPlacesTask,
        {
          text: wish.text,
          bounds: night?.bounds ?? wish.bounds,
          exclude,
          prefectures,
          lodging,
          ...(meal ? { meal } : {}),
          ...(night ? { lodgingContext: promptContext(night) } : {}),
        },
        { permit },
      )
      provider = result.provider
      const picked = pickCandidates(result.output, exclude, prefectures, night ? LODGING_POOL : MAX_CANDIDATES)
      places = lodging ? await settleLodgings(ports, night, picked, { provider, uid: wish.uid, tripMode: tripData ? groundMode(travelModeOf(tripData)) : 'car' }) : picked
    }

    const pins = places.map((place, index) => {
      const pin: Omit<Pin, 'createdAt' | 'updatedAt'> = {
        wishId,
        uid: wish.uid,
        name: place.name,
        ...(place.nameEn ? { nameEn: place.nameEn } : {}),
        ...(index === 0 && place.namedMatch ? { namedMatch: true } : {}),
        description: place.description,
        ...(place.descriptionEn ? { descriptionEn: place.descriptionEn } : {}),
        area: place.area,
        ...(place.areaEn ? { areaEn: place.areaEn } : {}),
        // 宿さがしの候補は、応答の種類にかかわらず宿にする（建つと、しおりの泊まる夜の宿になる）
        // ごはんの候補は、食べもののお店にする（建つと、しおりのそのごはんの位置に入る）
        category: lodging ? 'lodging' : meal ? 'food' : place.category,
        location: place.location,
        status: 'candidate',
        suggestedBy: provider,
        // 宿さがしで Places で確かめた宿は、その placeId（建てるときに、もう一度確かめない。features/verify-place）
        placeId: place.placeId ?? null,
        builtBy: null,
        buildStartedAt: null,
        ...(lodgingNight !== null && lodging ? { lodgingNight } : {}),
        ...(mealSlot ? { mealSlot } : {}),
        ...(events[index] ? { event: events[index] } : {}),
      }
      return { ref: trip.collection('pins').doc(candidatePinId(wishId, index)), pin }
    })

    // 書く直前に希望を読み直し、そのときの書いた人でピンを立てる。場所を探している途中に Google アカウントへ
    // 切り替わると、引き継ぎ（move-memberships）が希望の uid を今の自分に変える。最初に読んだ uid のままだと、
    // 候補が前の自分のものとして立ち、今の自分の地図に出ない。引き継ぎも希望とピンをトランザクションで読むので、
    // どちらが先に終わっても、ピンは今の自分のものになる
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(wishRef)).data() as Wish | undefined
      if (!current) return
      for (const { ref, pin } of pins) {
        tx.set(ref, {
          ...pin,
          uid: current.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      // イベントが日程のあいだに見つからなかったときは、その理由も書く（画面が「この日程のあいだに、この辺りでの開催は見つかりませんでした」と出す）
      tx.update(wishRef, places.length > 0 ? { status: 'done' } : { status: 'failed', ...(eventKinds ? { notFound: 'event' } : {}) })
    })
  } catch (cause) {
    console.error(`希望 ${tripId}/${wishId} の場所を探せませんでした`, cause)
    await wishRef.update({ status: 'failed' })
  }
}

/** しおりのルート（計画中はしおり、前の形で決まった旅は決まったルート）と建った場所から、その夜の様子を作る。しおりがなければ null */
async function nightContext(trip: DocumentReference, tripData: Trip, night: number): Promise<LodgingContext | null> {
  const routeId = tripData.status === 'decided' && tripData.decidedRouteId ? tripData.decidedRouteId : SHIORI_ROUTE_ID
  const [routeSnapshot, pinsSnapshot] = await Promise.all([trip.collection('routes').doc(routeId).get(), trip.collection('pins').where('status', '==', 'done').get()])
  const route = routeSnapshot.data() as Route | undefined
  if (!route) return null
  const pins = new Map(pinsSnapshot.docs.map((doc) => [doc.id, doc.data() as Pin]))
  return lodgingContext(
    route,
    night,
    (pinId) => {
      const pin = pins.get(pinId)
      return pin ? { name: pin.name, location: pin.location } : null
    },
    travelModeOf(tripData),
  )
}

/** Gemini に添える、その夜の様子（名前と時刻と手段だけ） */
function promptContext(context: LodgingContext): LodgingPromptContext {
  return {
    night: context.night,
    side: context.side,
    fromName: context.from.name,
    leaveAt: clockText(context.from.leaveAt),
    nextName: context.next?.name ?? null,
    moveMode: context.move?.mode ?? null,
    tripMode: groundMode(context.tripMode),
    hotelBy: clockText(hotelArriveBy(context.from.leaveAt)),
  }
}

/**
 * 宿さがしの候補を仕上げる（テストのために export する）。
 * 1. しおりの様子があれば、着く時刻と寄り道でふるい、寄り道の短い順に並べる（logic/lodgingPlan.ts の rankLodgings）
 * 2. 本物の Gemini の候補で、Places を呼べる設定で、希望を書いた人が合言葉を通している（か全員に開いている）ときは、
 *    上から LODGING_CHECKS_MAX 件まで Places で確かめる。宿でない・見つからない・（車の旅で）駐車場がない宿は外し、
 *    残した宿は Places の位置で確かめ直す（acceptLodging）。Places を呼べなかった候補は、確かめずに残す。
 *    確かめた宿で 3 件に足りなければ、ふるいを通った残りの候補を確かめずに足す
 * 3. 固定の応答（エリアの「◯◯駅周辺の宿」）は宿そのものではないので、Places では確かめない
 */
export async function settleLodgings(
  ports: Pick<SuggestPlacesPorts, 'placesApi' | 'aiGate'>,
  context: LodgingContext | null,
  places: readonly SuggestedPlace[],
  options: { provider: Pin['suggestedBy']; uid: string; tripMode: 'transit' | 'car' },
): Promise<SuggestedPlace[]> {
  const ranked = context ? rankLodgings(context, places) : [...places]
  const placesApi = ports.placesApi
  const checkable = options.provider !== 'stub' && placesApi?.enabled()
  if (!placesApi || !checkable || !((await ports.aiGate.isOpenToAll()) || (await ports.aiGate.isUnlocked(options.uid)))) return ranked.slice(0, MAX_CANDIDATES)
  const kept: SuggestedPlace[] = []
  for (const place of ranked.slice(0, LODGING_CHECKS_MAX)) {
    const found = await placesApi.findLodging({ text: placeQuery(place), near: place.location, parking: options.tripMode === 'car' })
    if (found === null) {
      kept.push(place)
      continue
    }
    if (found === 'not-found') continue
    const accepted = acceptLodging(context, place, found, options.tripMode === 'car')
    if (accepted) kept.push(accepted)
  }
  // 確かめた宿で足りなければ、ふるいを通った残りの候補を、確かめずに足す（Places を呼べなかった候補と同じ扱い。
  // カードには「実在の確認はしていません」と出る）。確かめた宿が先に並ぶ
  for (const place of ranked.slice(LODGING_CHECKS_MAX)) {
    if (kept.length >= MAX_CANDIDATES) break
    kept.push(place)
  }
  return kept
}

/**
 * 関所を通す（テストのために export する）。合言葉を通していない人の希望では回数を消費しない（先に unlocked を見る）。
 * 全員に開く切り替え（settings/ai）が入っていれば、合言葉は見ない
 */
export async function permitFor(ports: Pick<SuggestPlacesPorts, 'aiGate'>, uid: string, wishId: string): Promise<GeminiPermit | undefined> {
  const unlocked = (await ports.aiGate.isOpenToAll()) || (await ports.aiGate.isUnlocked(uid))
  const reserved = unlocked ? await ports.aiGate.reserveFlashCall() : false
  const decision = decideAiGate({ unlocked, reserved })
  if (decision !== 'ok') {
    console.info(`希望 ${wishId}：本物の Gemini は使わず固定の応答にします（${decision}）`)
    return undefined
  }
  return { uid, refund: () => ports.aiGate.refundFlashCall() }
}
