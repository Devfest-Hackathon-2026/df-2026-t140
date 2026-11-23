import { isLodgingSkip, type Route } from '../../domain/route'
import { buildPlan, type FlightChoices, type PlanOrigin, type PlanPlace, routeTiming } from '../../domain/routePlan'
import { MAX_STOPS, nextStopId, pinOfStop, renameStops, visitOrder } from '../../domain/visit'

// 同じ場所を旅の中で何度も訪れるための、しおりの行の複製と削除の、純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** 行を足した・消したあとのルート。変わる項目だけ */
export type VisitUpdate = Pick<Route, 'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>

type VisitRoute = Pick<Route, 'style' | 'pinIds' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>

function replanned(route: VisitRoute, order: readonly PlanPlace[], origin: PlanOrigin, days: number, flights?: FlightChoices): VisitUpdate {
  return {
    // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
    ...buildPlan(order, origin, days, routeTiming(route), undefined, route.legModes, flights ?? { saved: route.legFlights }),
    revision: (route.revision ?? 0) + 1,
  }
}

/**
 * しおりの行（stopId）のすぐ下に、同じ場所の行を足し、時刻と日の分け方を計算し直す（企画書「ユーザー体験」3-6、#528）。
 * - 足した行の ID は「ピンの ID~番号」（domain/visit.ts）。建物（ピン）は増やさない
 * - ほかの行の順番と、人が直した時刻は変えない。足した行の時刻は自動で組む
 * - 元の行から次の場所までの区間で選んだ手段と便は、足した行から次の場所までの区間に引き継ぐ（次の場所へ出るのは、足した行になるため）
 * - 日の分け方は、しおりと同じく、その日の 19 時までに入るかで決める（domain/routePlan.ts の dayPacker）
 * - 宿の行（泊まる夜の宿に決めた建物の行）を複製しても、足した行は宿にならない。宿のすぐ下なので、翌日の最初の行になる
 *   （複製した行をほかの夜の宿にするのは、宿の枠の「前の夜と同じ宿にする」。features/set-lodging）
 * - その行が今のしおりになければ 'stale'、行の数が上限（MAX_STOPS）なら 'full'
 * places は、建った場所のすべて（順は問わない）。
 */
export function routeWithVisitAdded(
  route: VisitRoute,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  stopId: string,
  flights?: FlightChoices,
): VisitUpdate | 'stale' | 'full' {
  const order = visitOrder(route.pinIds, places)
  const index = order.findIndex((place) => place.id === stopId)
  if (index < 0) return 'stale'
  if (order.length >= MAX_STOPS) return 'full'
  const pinId = pinOfStop(stopId)
  const added = nextStopId(route.pinIds, pinId)
  const next = order[index + 1]?.id
  order.splice(index + 1, 0, { ...order[index], id: added, pinId })
  // 元の行 → 次の場所の区間の選択を、足した行 → 次の場所に付け替える（人が直した時刻は行ごとのものなので、そのまま）
  const moved = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => {
    const from = `${stopId}>${next}`
    if (!record || !next || !(from in record)) return record
    const { [from]: value, ...rest } = record
    return { ...rest, [`${added}>${next}`]: value }
  }
  return replanned({ ...route, legModes: moved(route.legModes), legFlights: moved(route.legFlights) }, order, origin, days, flights)
}

/**
 * しおりの行（stopId）を 1 つ消し、残りの順で時刻と日の分け方を計算し直す。建物は消さない。
 * - 同じ場所の行が 2 つ以上あるときだけ消せる。最後の 1 行なら 'last'（場所ごと外すのは、建物を消す。features/remove-building）
 * - 消した行の、人が直した時刻と区間の選択は外す
 * - ピンの ID そのままの行を消したら、その場所の残りの行のうち先頭の 1 つを、ピンの ID に付け替える
 *   （しおりに場所があるあいだ、ピンの ID の行が必ずあるようにする。domain/visit.ts）。その行の時刻と区間の選択は引き継ぐ
 * - 宿の行（泊まる夜の宿に決めた建物の行）を消したら、その夜の宿も外す（決まっていない夜に戻る。付け替えた行が、別の位置で宿にならないように）。
 *   前の夜と同じ宿にした夜の宿（複製した行）がピンの ID の行に付け替わるときは、その夜の宿も付け替えた先の行にする（2 泊目の宿を失わない）
 * - その行が今のしおりになければ 'stale'
 */
export function routeWithVisitRemoved(
  route: VisitRoute,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  stopId: string,
  flights?: FlightChoices,
): VisitUpdate | 'stale' | 'last' {
  const order = visitOrder(route.pinIds, places)
  const index = order.findIndex((place) => place.id === stopId)
  if (index < 0) return 'stale'
  const pinId = pinOfStop(stopId)
  if (order.filter((place) => pinOfStop(place.id) === pinId).length < 2) return 'last'
  order.splice(index, 1)
  const promoted = stopId === pinId ? order.find((place) => pinOfStop(place.id) === pinId)?.id : undefined
  const rename = (id: string) => (id === stopId ? null : id === promoted ? pinId : id)
  const kept = renameStops({ stopTimes: route.stopTimes, legModes: route.legModes, legFlights: route.legFlights }, rename)
  // 付け替えた行は、ピンの ID の行として並べ直す
  const stopIds = order.map((place) => (place.id === promoted ? pinId : place.id))
  // 消した行の夜の宿は外し、付け替えた行（前の夜と同じ宿にした夜の、複製した宿の行）の夜の宿は、付け替えた先の行の ID にする
  const lodging =
    route.lodging &&
    Object.fromEntries(
      Object.entries(route.lodging).flatMap(([night, value]) => {
        if (isLodgingSkip(value)) return [[night, value]]
        const renamed = rename(value)
        return renamed === null ? [] : [[night, renamed]]
      }),
    )
  return replanned({ ...route, ...kept, lodging }, visitOrder(stopIds, places), origin, days, flights)
}
