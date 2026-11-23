import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { buildPlan, type FlightChoices, ORIGIN_KEY, type PlanOrigin, planPlace, routeTiming } from '../../domain/routePlan'
import { visitOrder } from '../../domain/visit'

export function originName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 40 ? value.trim() : null
}

/**
 * 出発地点だけを変え、訪問順と滞在先は保つ。flights を渡すと、飛行機の区間の便を新しい出発地点から決め直す（domain/flightPlanner.ts の searchingFlights）。
 * 返す pinIds は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）。保存する順番も行の順にそろう
 */
export function routeWithOrigin(route: Route, pins: readonly (Pin & { id: string })[], origin: PlanOrigin, days: number, flights?: FlightChoices) {
  const order = visitOrder(route.pinIds, pins.map((pin) => planPlace(pin.id, pin)))
  // 集合場所からの区間に残した便は、前の集合場所から間に合う便なので外す（区間のキーは @origin>ピン で、集合場所の位置を持たない）。
  // 時刻表が取れて決め直すときは使わないが、取れないときに、前の集合場所の空港を出る便が残らないようにする（その区間は目安になる）
  const saved = route.legFlights && Object.fromEntries(Object.entries(route.legFlights).filter(([key]) => !key.startsWith(`${ORIGIN_KEY}>`)))
  return {
    ...buildPlan(order, origin, days, routeTiming(route), undefined, route.legModes, { ...flights, saved }),
    revision: (route.revision ?? 0) + 1,
  }
}
