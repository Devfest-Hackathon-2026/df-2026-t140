import { isLodgingSkip, type Route } from '../../domain/route'
import { buildPlan, type FlightChoices, type PlanOrigin, type PlanPlace, routeTiming } from '../../domain/routePlan'
import { stopOfTimeKey, visitOrder } from '../../domain/visit'

// しおりの行を動かす（差し込む）ときの、純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** 行を動かしたあとのルート。変わる項目だけ */
export type MoveUpdate = Pick<Route, 'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>

/**
 * しおりの行（fromPinId）を、落とした先の行（toPinId）の位置に差し込み、その順で時刻と日の分け方を計算し直す（企画書「ユーザー体験」3-6）。
 * - 取った行は、落とした先の行がいた位置に入る。あいだの行（落とした先の行を含む）は、取った行がいた側へ 1 つずつずれる。
 *   下へ動かせば落とした先の行のすぐ下に、上へ動かせばすぐ上に入る（Youkin06 の依頼、2026-11-21。前は 2 つの行の入れ替えだった）
 * - ほかの行の順番は変えない。日の分け方は、しおりと同じく、その日の 19 時までに入るかで決める（domain/routePlan.ts の dayPacker）
 * - 時刻は、そのルートの時間の決め（滞在、出発の時刻）のまま、直線距離の目安で計算し直す（Routes の時間は保存しない）
 * - 建っていない（消えた）場所は飛ばす
 * - しおりで人が直した時刻は守る。ただし位置が変わった行（取った行から落とした先の行まで）の着く時刻は外す
 * - どちらかがしおりにない、同じ行どうしなら null
 * - 宿の行（泊まる夜の宿に決めた建物の行）は取れない（null）。宿は、その日の最後の行のまま。宿の行の上に落とすのはよく、
 *   下から運べば宿のすぐ上（その日の最後の場所）に、上から運べば宿のすぐ下（翌日の最初）に入る
 * - 時刻が決まったイベントの行（#581）も取れない（null）。開催の時刻と日から動かさない。ほかの行をイベントの前後に落とすのはよい
 * - fromPinId と toPinId は行の ID（同じ場所を何度も訪れるしおりでは、2 回目からの行は「ピンの ID~番号」。domain/visit.ts）
 * - flights を渡すと、便が決まっていない・乗れなくなった飛行機の区間の便を探す（domain/flightPlanner.ts の searchingFlights）
 * places は、建った場所のすべて（順は問わない）。
 */
export function moveStop(
  route: Pick<Route, 'style' | 'pinIds' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  fromPinId: string,
  toPinId: string,
  flights?: FlightChoices,
): MoveUpdate | null {
  if (fromPinId === toPinId) return null
  if (Object.values(route.lodging ?? {}).some((value) => !isLodgingSkip(value) && value === fromPinId)) return null
  const order = visitOrder(route.pinIds, places)
  const from = order.findIndex((place) => place.id === fromPinId)
  const to = order.findIndex((place) => place.id === toPinId)
  if (from < 0 || to < 0 || order[from].event) return null
  // 位置が変わる行（取った行から落とした先の行まで）。人が直した着く時刻と出る時刻は、前の位置で決めたものなので外す。
  // ほかの行の時刻と、集合時間・出発時間は残す
  const shifted = new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1).map((place) => place.id))
  order.splice(to, 0, ...order.splice(from, 1))
  const stopTimes = route.stopTimes && Object.fromEntries(Object.entries(route.stopTimes).filter(([key]) => !shifted.has(stopOfTimeKey(key))))
  return {
    // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
    ...buildPlan(order, origin, days, routeTiming({ style: route.style, stopTimes, lodging: route.lodging }), undefined, route.legModes, flights ?? { saved: route.legFlights }),
    revision: (route.revision ?? 0) + 1,
  }
}
