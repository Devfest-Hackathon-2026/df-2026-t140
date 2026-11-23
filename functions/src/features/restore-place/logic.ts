import { measureTrip } from '../../domain/dropToFit'
import { placeBack } from '../../domain/placeBack'
import type { Route } from '../../domain/route'
import { buildPlan, type FlightChoices, type PlanOrigin, type PlanPlace, routeTiming, settleEvents } from '../../domain/routePlan'
import { visitOrder } from '../../domain/visit'

// しおりから外した場所を、人の手でしおりに戻すときの純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/edit-trip-dates.test.mjs）

/**
 * しおりから外した場所（leftOutPinIds）を 1 つ、しおりに戻す（場所カードの「しおりに戻す」。Takana の決定、2026-11-23、バグ30）。
 * 人が選んで戻すので、時間に収まらなくても戻す（ほかの場所は外さない）。入れる位置は domain/placeBack.ts の placeBack
 * （宿は空いている夜、ごはんのお店は空いている枠、それ以外は 19 時を越える分 → 移動 がいちばん少ない位置）。
 * 外した印がない、場所が建っていなければ null。places は建った場所のすべて（戻す場所を含む）
 */
export function routeWithPlaceBack(
  route: Pick<Route, 'style' | 'pinIds' | 'revision' | 'addedPinIds' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging' | 'leftOutPinIds'> & Partial<Pick<Route, 'meals'>>,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  pinId: string,
  flights?: FlightChoices,
) {
  const leftOut = route.leftOutPinIds
  if (!leftOut?.includes(pinId)) return null
  const place = places.find((item) => item.id === pinId)
  if (!place) return null
  const timing = routeTiming(route)
  // 位置を決める物差しは、人が直した時刻を使わない（日程の変更と同じ）
  const { stopTimes: _stopTimes, lodging: _lodging, ...plain } = timing
  const measure = (lodging: Record<string, string> | undefined) => measureTrip(origin, days, lodging ? { ...plain, lodging } : plain, route.legModes)
  const state = placeBack(
    { order: visitOrder(route.pinIds, places), lodging: route.lodging ? { ...route.lodging } : undefined, meals: route.meals },
    place,
    { origin, days, timing, legModes: route.legModes, measure },
  )
  // 手で戻すときは宿の夜が空いていなくても入れる（lodgingNightOnly なし）ので、null にならない
  if (!state) return null
  const { lodging: _saved, ...rest } = timing
  const finalTiming = state.lodging ? { ...rest, lodging: state.lodging } : rest
  const order = settleEvents(state.order, origin, days, finalTiming, route.legModes)
  return {
    // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
    ...buildPlan(order, origin, days, finalTiming, undefined, route.legModes, flights ?? { saved: route.legFlights }),
    revision: (route.revision ?? 0) + 1,
    addedPinIds: [...(route.addedPinIds ?? []).filter((id) => id !== pinId), pinId],
    leftOutPinIds: leftOut.filter((id) => id !== pinId),
    ...(state.meals && state.meals !== route.meals ? { meals: state.meals } : {}),
  }
}
