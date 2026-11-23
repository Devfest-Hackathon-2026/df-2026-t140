import { FieldValue } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import { decideAiGate, gateCandidates } from '../../domain/geminiBudget'
import { tripOrigin } from '../../domain/tripOrigin'
import type { Pin } from '../../domain/pin'
import { type Route, SHIORI_ROUTE_ID } from '../../domain/route'
import { type PlanPlace, planPlace, tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import type { GeminiPermit } from '../../ports/gemini'
import { addToDecidedRoute, chooseOptions, draftShiori, enoughPlacesForShiori, placesKey, rankRequest } from './logic'
import type { ProposeRoutesPorts } from './ports'
import { proposeRoutesTask, rankPlacesTask } from './prompt'
import type { ProposeRoutesInput, UpdateRoutesResult } from './types'

/** ほかの建築と重なって読み直す回数 */
const ATTEMPTS = 3

export interface UpdateRoutesOptions {
  /**
   * 今の Gemini の経路に費用がかかる（vertex）か。true なら、呼ぶ前に関所（aiGate）を通し、
   * 通ったときだけ印（GeminiPermit）を付ける。false（stub、agy）なら関所は見ない
   */
  guarded: boolean
}

/**
 * 建物が建ったあとに、しおりのルートを更新する。読む → logic で決める → 書く。
 * 2026-11-07 にルート案と投票をやめ、建った場所がしおりに旅の順で並ぶ形にした（企画書「ユーザー体験」2-4、3）。
 *
 * - 計画中の旅：建物が 1 つ建ったときに、しおりのルート（ID は SHIORI_ROUTE_ID）を 1 本作る。
 *   2 つ目からは、今の順番を変えずに、移動がいちばん増えない位置に足す（addToShioriRoute）。投票はない
 * - 決まった旅（前の形で投票まで済んだもの）：決まったルートに足す（同じく addToShioriRoute）
 *
 * 同じイベントが 2 回届いても、結果は変わらない：
 * - 作るときは 1 つのトランザクションで、しおりがもうあるか、建った場所が計算のときと同じかを確かめる。
 *   ほかの建築が先に作っていたら、読み直して足す側に回る
 * - 足すときは、まだ入っていない場所だけを足す。足す場所がなければ何もしない
 *
 * 飛行機の区間（遠い区間と島への区間は、選ばなくても飛行機）があれば、作るときも足すときも、ANA・JAL の時刻表（ODPT。料金はかからない）から便を決める
 * （押さなくても便が出るように。かめの決定、2026-11-20、#482）。時刻表を読むのは、便を探す区間があるときだけ（searchingFlights）
 *
 * 費用：経路が vertex のときは、建った場所の持ち主（pin.uid）の誰かが合言葉を通していて（aiAccess/{uid}）、
 * Flash の累計が上限の中（usage/flash、場所の候補と同じ数）のときだけ印を付ける。印がなければ呼び出し口が
 * 固定の応答に戻す（design-principles の cost/gemini-guarded）
 */
export async function updateRoutesForTrip(
  ports: ProposeRoutesPorts,
  tripId: string,
  options: UpdateRoutesOptions = { guarded: false },
): Promise<UpdateRoutesResult> {
  const { db, gemini } = ports
  const tripRef = db.collection('trips').doc(tripId)
  const donePins = tripRef.collection('pins').where('status', '==', 'done')
  const shioriRef = tripRef.collection('routes').doc(SHIORI_ROUTE_ID)

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const [tripSnapshot, pinsSnapshot, shioriSnapshot] = await Promise.all([tripRef.get(), donePins.get(), shioriRef.get()])
    const trip = tripSnapshot.data() as Trip | undefined
    if (!trip) return 'skipped'
    if (trip.status === 'decided' && trip.decidedRouteId) return addToShioriRoute(ports, tripId, trip.decidedRouteId, options)
    if (trip.status !== 'planning' || !enoughPlacesForShiori(pinsSnapshot.size)) return 'skipped'
    // ルート案の Gemini をもう呼んだあと（attempt > 0。ほかの建築が先にしおりを作った）は、順位付けの Gemini を続けて呼ばない
    // （トリガーの打ち切りは Gemini 1 回とやり直し 1 回の分。handler.ts）。外す順は自分たちの計算にする
    if (shioriSnapshot.exists) return addToShioriRoute(ports, tripId, SHIORI_ROUTE_ID, options, attempt === 0)

    const input: ProposeRoutesInput = {
      tripTitle: trip.title,
      origin: tripOrigin(trip),
      days: tripDays(trip.startDate, trip.endDate),
      places: pinsSnapshot.docs.map((snapshot) => {
        const pin = snapshot.data() as Pin
        return { ...planPlace(snapshot.id, pin), category: pin.category }
      }),
    }
    const key = placesKey(input.places.map((place) => place.id))
    // Gemini を呼ぶのは 1 回目だけ。読み直したあとは自分たちの計算（stub）で作り、トリガーの打ち切り時間
    // （handler.ts、Gemini 1 回とやり直し 1 回の分）に収める
    const result =
      attempt === 0
        ? await gemini.run(proposeRoutesTask, input, {
            permit: options.guarded ? await routesPermit(ports, input.places.map((place) => place.uid), tripId) : undefined,
          })
        : { output: proposeRoutesTask.stub(input), provider: 'stub' as const, fellBack: false }
    const chosen = chooseOptions(result, input)
    // 便を探す飛行機の区間があれば、時刻表を読んで便を決める（トランザクションの外で）
    const draft = await searchingFlights(
      () => ports.flights.timetable(),
      async (search) => draftShiori(chosen.options, input, chosen.proposedBy, search(input.origin, trip.startDate, undefined)),
    )
    if (!draft) return 'skipped'

    const outcome = await db.runTransaction(async (tx): Promise<UpdateRoutesResult | 'stale'> => {
      const [tripNow, pinsNow, shioriNow] = await Promise.all([tx.get(tripRef), tx.get(donePins), tx.get(shioriRef)])
      const latestTrip = tripNow.data() as Trip | undefined
      const status = latestTrip?.status
      if (status !== 'planning') return status === 'decided' ? 'stale' : 'skipped'
      // 生成を待つあいだに集合場所や日程が変わった場合、古い出発地点のしおりを保存しない。
      if (!latestTrip || latestTrip.origin !== trip.origin || latestTrip.startDate !== trip.startDate || latestTrip.endDate !== trip.endDate
        || JSON.stringify(tripOrigin(latestTrip)) !== JSON.stringify(input.origin)) return 'stale'
      // ほかの建築が先に作った、計算しているあいだに建物が増えた：読み直す（次は足す側に回る）
      if (shioriNow.exists || placesKey(pinsNow.docs.map((snapshot) => snapshot.id)) !== key) return 'stale'
      const { id: _id, ...route } = draft
      tx.set(shioriRef, { ...route, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return 'proposed'
    })
    if (outcome !== 'stale') return outcome
  }
  return 'skipped'
}

/** 建った場所（ピンの最後に変わった時刻の順）。しおりに足すときも、Gemini に順を聞くときも同じ並びにする */
function builtPlaces(docs: readonly { id: string; data(): unknown }[]): PlanPlace[] {
  return docs
    .map((snapshot) => ({ id: snapshot.id, pin: snapshot.data() as Pin }))
    .sort((left, right) => left.pin.updatedAt.toMillis() - right.pin.updatedAt.toMillis() || left.id.localeCompare(right.id))
    .map(({ id, pin }) => planPlace(id, pin))
}

/**
 * 建った場所を足すとしおりが時間に収まらなくなるなら、Gemini に残したい順を聞く（#622）。収まるなら呼ばない（undefined）。
 * トランザクションの外で 1 回だけ読む。読んだあとに建物が増えて順が合わなくなっても、addToDecidedRoute が自分たちの計算の順に戻す。
 * 費用：経路が vertex のときは、ルート案と同じ関所（routesPermit）を通ったときだけ本物を呼ぶ。通らなければ固定の応答（空の順）
 */
async function askRanking(ports: ProposeRoutesPorts, tripId: string, routeId: string, options: UpdateRoutesOptions): Promise<string[] | undefined> {
  const tripRef = ports.db.collection('trips').doc(tripId)
  const [tripSnapshot, routeSnapshot, pinsSnapshot] = await Promise.all([
    tripRef.get(),
    tripRef.collection('routes').doc(routeId).get(),
    tripRef.collection('pins').where('status', '==', 'done').get(),
  ])
  const trip = tripSnapshot.data() as Trip | undefined
  const route = routeSnapshot.data() as Route | undefined
  if (!trip || !route || isConfirmed(trip)) return undefined
  const places = builtPlaces(pinsSnapshot.docs)
  const input = rankRequest(route, places, tripOrigin(trip), tripDays(trip.startDate, trip.endDate), trip.title)
  if (!input) return undefined
  const permit = options.guarded ? await routesPermit(ports, places.map((place) => place.uid), tripId) : undefined
  const result = await ports.gemini.run(rankPlacesTask, input, { permit })
  return result.output.ranking
}

/**
 * しおりのルートに、建った場所を足す（企画書「ユーザー体験」2-4）。
 * 今のルートの順番は変えず、移動がいちばん増えない位置に入れる。画面は、ルートの revision が増えたのを見て知らせる。
 * 足すと時間に収まらないときは、場所をしおりから外す（外す順は Gemini の残したい順。askRanking。#622）。
 *
 * 1 つのトランザクションで、ルートと建った場所を読み、まだ入っていない場所だけを足す。
 * 同じイベントが 2 回届いても、2 回目は足す場所がないので何もしない。
 * 足したあとに便を探す飛行機の区間があれば、時刻表を読んでからトランザクションをやり直す（searchingFlights）。
 */
async function addToShioriRoute(
  ports: ProposeRoutesPorts,
  tripId: string,
  routeId: string,
  options: UpdateRoutesOptions,
  askGemini = true,
): Promise<UpdateRoutesResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(tripId)
  const ranking = askGemini ? await askRanking(ports, tripId, routeId, options) : undefined
  return searchingFlights(() => ports.flights.timetable(), (search) => db.runTransaction(async (tx): Promise<UpdateRoutesResult> => {
    const tripSnapshot = await tx.get(tripRef)
    const trip = tripSnapshot.data() as Trip | undefined
    // 旅程が確定しているあいだは、しおりに場所を足さない（features/confirm-shiori。確定は、作っている途中の建物がないときだけ受ける）
    if (!trip || isConfirmed(trip)) return 'skipped'
    const routeRef = tripRef.collection('routes').doc(routeId)
    const [routeSnapshot, pinsSnapshot] = await Promise.all([
      tx.get(routeRef),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    const route = routeSnapshot.data() as Route | undefined
    if (!route) return 'skipped'
    // 建った順（ピンが最後に変わった時刻の順）に足す
    const places = builtPlaces(pinsSnapshot.docs)
    const origin = tripOrigin(trip)
    const update = addToDecidedRoute(
      route,
      places,
      origin,
      tripDays(trip.startDate, trip.endDate),
      search(origin, trip.startDate, route.legFlights),
      ranking,
    )
    if (!update) return 'skipped'
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return 'rerouted'
  }))
}

/**
 * 関所を通す（テストのために export する）。建った場所の持ち主を順に見て、合言葉を通した人が 1 人もいなければ回数を消費しない（先に unlocked を見る）
 */
export async function routesPermit(ports: Pick<ProposeRoutesPorts, 'aiGate'>, uids: readonly string[], tripId: string): Promise<GeminiPermit | undefined> {
  const gate = ports.aiGate
  const candidates = gateCandidates(uids)
  // 全員に開く切り替え（settings/ai）が入っていれば、合言葉は見ずに最初の人の名前で印を付ける
  let unlockedUid: string | undefined = (await gate.isOpenToAll()) ? candidates[0] : undefined
  for (const uid of unlockedUid ? [] : candidates) {
    if (await gate.isUnlocked(uid)) {
      unlockedUid = uid
      break
    }
  }
  const reserved = unlockedUid ? await gate.reserveFlashCall() : false
  const decision = decideAiGate({ unlocked: unlockedUid !== undefined, reserved })
  if (decision !== 'ok' || !unlockedUid) {
    console.info(`旅 ${tripId} のしおり：本物の Gemini は使わず固定の応答にします（${decision}）`)
    return undefined
  }
  return { uid: unlockedUid, refund: () => gate.refundFlashCall() }
}
