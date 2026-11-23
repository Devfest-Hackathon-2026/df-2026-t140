import { isLodgingSkip, lodgingSkipValue, type Route } from '../../domain/route'
import { assignLodging, buildPlan, dayPacker, type FlightChoices, type PlanOrigin, type PlanPlace, routeTiming } from '../../domain/routePlan'
import { MAX_STOPS, nextStopId, pinOfStop, visitOrder } from '../../domain/visit'

// 泊まる夜を「宿を取らない夜」にする・取り消すときの、純粋な決め。Emulator なしで試せる（scripts/lodging.test.mjs）

export type LodgingSkipUpdate = Pick<Route, 'lodging' | 'revision'>

/**
 * 泊まる夜（night。1 日目の夜が 1）を、宿を取らない夜にする（skip が true）か、それを取り消して点線の枠に戻す（false）。
 * 車中泊や夜行の移動のように、宿を取らない夜のためのもの。note は、自分で書いた過ごし方（「車中泊」。なくてもよい）。
 * 行程（順番、時刻）は変わらない。
 * - 夜が旅の日程にない（1 〜 days - 1 でない）なら 'invalid'
 * - その夜の宿が、もう建物で決まっているなら 'decided'（宿を外すには、その建物を消す）
 * - もうその形（過ごし方も同じ）なら 'unchanged'
 */
export function lodgingAfterSkip(
  route: Pick<Route, 'lodging' | 'revision'>,
  days: number,
  night: number,
  skip: boolean,
  note?: string | null,
): LodgingSkipUpdate | 'invalid' | 'decided' | 'unchanged' {
  if (!Number.isInteger(night) || night < 1 || night >= days) return 'invalid'
  const key = String(night)
  const now = route.lodging?.[key]
  if (now !== undefined && !isLodgingSkip(now)) return 'decided'
  const next = skip ? lodgingSkipValue(note) : undefined
  if (now === next) return 'unchanged'
  const lodging = { ...(route.lodging ?? {}) }
  if (next) lodging[key] = next
  else delete lodging[key]
  return { lodging, revision: (route.revision ?? 0) + 1 }
}

/** 前の夜と同じ宿にしたあとのルート。変わる項目だけ */
export type SameLodgingUpdate = Pick<Route, 'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>

/**
 * 泊まる夜（night）を、前の夜（night - 1）と同じ宿にする（同じ宿に 2 泊以上する。Takana の依頼、2026-11-22）。
 * 前の夜の宿の行を複製し（同じ場所を何度も訪れる行。domain/visit.ts）、その行をこの夜の宿にして、時刻と日の分け方を計算し直す。
 * 複製した行は、その夜までの最後の場所のすぐあとに入る（建った宿を入れるときと同じ。domain/routePlan.ts の assignLodging）。
 * - 夜が旅の日程にない、1 日目の夜（前の夜がない）なら 'invalid'
 * - その夜の宿が、もう建物で決まっているなら 'decided'。宿を取らないと決めた夜は、同じ宿で上書きする
 * - 前の夜の宿が建物で決まっていない（まだ決めていない、宿を取らない）なら 'no-previous'
 * - 前の夜の宿の行が今のしおりにないなら 'stale'、行の数が上限（MAX_STOPS）なら 'full'
 * places は、建った場所のすべて（順は問わない）
 */
export function routeWithSameLodging(
  route: Pick<Route, 'style' | 'pinIds' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  night: number,
  flights?: FlightChoices,
): SameLodgingUpdate | 'invalid' | 'decided' | 'no-previous' | 'stale' | 'full' {
  if (!Number.isInteger(night) || night < 2 || night >= days) return 'invalid'
  const now = route.lodging?.[String(night)]
  if (now !== undefined && !isLodgingSkip(now)) return 'decided'
  const previous = route.lodging?.[String(night - 1)]
  if (!previous || isLodgingSkip(previous)) return 'no-previous'
  const order = visitOrder(route.pinIds, places)
  const inn = order.find((place) => place.id === previous)
  if (!inn) return 'stale'
  if (order.length >= MAX_STOPS) return 'full'
  const pinId = pinOfStop(previous)
  const copy: PlanPlace = { ...inn, id: nextStopId(route.pinIds, pinId), pinId }
  // この夜を空けてから入れる（宿を取らないと決めた夜も、同じ宿で上書きする）
  const lodging = { ...(route.lodging ?? {}) }
  delete lodging[String(night)]
  const timing = routeTiming({ ...route, lodging })
  const pack = timing.stayScale !== undefined ? dayPacker(origin, timing) : undefined
  const assigned = assignLodging(order, copy, days, lodging, night, pack)
  if (!assigned || assigned.night !== night) return 'invalid'
  const next = { ...route, lodging: assigned.lodging }
  return {
    // 保存する順番は、buildPlan が返すしおりの行の順（宿に間に合わない場所を回したあと。#602）
    ...buildPlan(assigned.order, origin, days, routeTiming(next), undefined, route.legModes, flights ?? { saved: route.legFlights }),
    revision: (route.revision ?? 0) + 1,
  }
}
