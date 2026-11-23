import type { Route } from '../../domain/route'
import {
  buildPlan,
  DAY_MINUTES,
  eventClashes,
  type EventCheck,
  type FlightChoices,
  MEET_KEY,
  MEET_LEAD_MINUTES,
  ORIGIN_KEY,
  type PlanOrigin,
  type PlanPlace,
  routeTiming,
} from '../../domain/routePlan'
import { LEAVE_MARK, stopOfTimeKey } from '../../domain/visit'

// しおりの時刻を人が直すときの、純粋な決め。Emulator なしで試せる（scripts/functions.test.mjs）

// pinIds は、buildPlan が返すしおりの行の順（夜景を日の最後へ、宿に間に合わない場所を宿のあとへ回したあと）。直すたびに保存する順番も行の順にそろう（#602）
export type StopTimeUpdate = Pick<
  Route,
  'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'
>

/** 直せる時刻か（0 時 0 分から 23 時 59 分までの、分の整数） */
export function isDayMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < DAY_MINUTES
}

/**
 * しおりの時刻（key）を minutes にして、しおりを組み直す。key は、集合時間が @meet、出発地を出る時間が @origin、
 * 場所に着く時刻がその行の ID、場所を出る時刻が行の ID@leave。場所が今のしおりにない（ほかの人が消した）ときは 'stale'。
 * 時刻の守り方は domain/routePlan.ts の buildPlan（直した場所からあとがずれ、同じ日の前の場所にいる時間が伸び縮みする）。
 * 集合時間が出発時間より遅くならないようにする（keepMeetBeforeDepart）。
 * 同じ日のとなり合う行の、出る時刻と次の着く時刻は、両方を残さない（直したほうを残す）。
 * 出発時間は、電車・バスなら一番近い電車に合わせたいが、時刻表がないので入れた時刻をそのまま使う（buildPlan のコメント）。
 * flights.plan を渡すと、飛行機の区間の便を、組み直した出発の時刻から選び直す
 */
export function routeWithStopTime(
  route: Pick<Route, 'style' | 'revision' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging'>,
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  key: string,
  minutes: number,
  flights?: FlightChoices,
): StopTimeUpdate | 'stale' {
  if (key !== MEET_KEY && key !== ORIGIN_KEY && !order.some((place) => place.id === stopOfTimeKey(key))) return 'stale'
  const build = (times: Record<string, number>) =>
    buildPlan(order, origin, days, routeTiming({ style: route.style, stopTimes: times, lodging: route.lodging }), undefined, route.legModes ?? {}, flights ?? { saved: route.legFlights })
  let stopTimes = keepMeetBeforeDepart(route, key, minutes)
  let plan = build(stopTimes)
  // 直した出る時刻が、次の場所の直した着く時刻に負けて外れた（buildPlan）ときは、着く時刻のほうを外して組み直す。
  // 日をまたぐ区間と飛行機の区間では、buildPlan は両方を残すので、ここでも外さない。
  // 着く時刻を直したときに前の場所の出る時刻が負けるのは、buildPlan が外す
  // 宿の行の出る時刻のように、次の着く時刻を外しても効かないときは、外さない
  if (key.endsWith(LEAVE_MARK) && plan.stopTimes && !(key in plan.stopTimes)) {
    const retried = withoutNextArrival(stopTimes, order, key)
    const replanned = build(retried)
    if (replanned.stopTimes && key in replanned.stopTimes) {
      stopTimes = retried
      plan = replanned
    }
  }
  return {
    ...plan,
    legModes: plan.legModes ?? {},
    legFlights: plan.legFlights ?? {},
    stopTimes: plan.stopTimes ?? stopTimes,
    revision: (route.revision ?? 0) + 1,
  }
}

/** key が、時刻が決まったイベントの行の時刻（着く時刻か出る時刻）か。イベントの時刻は人が直せない（#581） */
export function isEventTime(order: readonly PlanPlace[], key: string): boolean {
  return Boolean(order.find((place) => place.id === stopOfTimeKey(key))?.event)
}

/**
 * stopTimes で組んだときに、時刻が決まったイベントの時間と重なっている行の ID（domain/routePlan.ts の eventClashes）。
 * 飛行機の便は時刻表を引かず、残してある便か目安で見る
 */
export function clashesWith(
  route: Pick<Route, 'style' | 'legModes' | 'legFlights' | 'lodging'>,
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  stopTimes: Record<string, number> | undefined,
): string[] {
  const checks: EventCheck[] = []
  buildPlan(order, origin, days, routeTiming({ style: route.style, stopTimes, lodging: route.lodging }), undefined, route.legModes ?? {}, { saved: route.legFlights }, checks)
  return eventClashes(checks)
}

/** 直す前には重なっていなかったのに、直したあとに重なるイベント（行の ID）。人に確かめるのは、これがあるときだけ（Takana の決定、2026-11-21） */
export function newClashes(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((id) => !before.includes(id))
}

/** 出る時刻のキーの行の、次の行の直した着く時刻を外した stopTimes */
function withoutNextArrival(stopTimes: Record<string, number>, order: readonly PlanPlace[], key: string): Record<string, number> {
  const at = order.findIndex((place) => place.id === stopOfTimeKey(key))
  const next = order[at + 1]
  if (at < 0 || !next) return stopTimes
  const { [next.id]: _dropped, ...kept } = stopTimes
  return kept
}

/**
 * 時刻を 1 つ直したあとの stopTimes。集合時間を出発時間より遅くしたら、直す前の「集合から出発までの差」を保ったまま、
 * 出発時間を新しい集合時間のあとへずらす（Takana の依頼、2026-11-20）。出発時間を、直した集合時間より早くしたら、同じ差で集合時間を前へずらす（実装した AI が仮に選んだ）。
 * 直す前の時刻は buildPlan と同じ決め方（出発は直していなければ組み方の始まり、集合は直していなければ出発の MEET_LEAD_MINUTES 分前）。
 * 前の差が負（前の形で集合が出発より遅かった）なら、MEET_LEAD_MINUTES 分にする。ずらした先は 0 時 0 分から 23 時 59 分に収める
 */
export function keepMeetBeforeDepart(
  route: Pick<Route, 'style' | 'stopTimes'>,
  key: string,
  minutes: number,
): Record<string, number> {
  const saved = route.stopTimes ?? {}
  const stopTimes: Record<string, number> = { ...saved, [key]: minutes }
  if (key !== MEET_KEY && key !== ORIGIN_KEY) return stopTimes
  const savedAt = (name: string) => (isDayMinutes(saved[name]) ? saved[name] : undefined)
  const depart = savedAt(ORIGIN_KEY) ?? routeTiming(route).startMinutes
  const meet = savedAt(MEET_KEY) ?? Math.max(0, depart - MEET_LEAD_MINUTES)
  const lead = depart - meet >= 0 ? depart - meet : MEET_LEAD_MINUTES
  if (key === MEET_KEY && minutes > depart) stopTimes[ORIGIN_KEY] = Math.min(DAY_MINUTES - 1, minutes + lead)
  // 集合時間を直していなければ、buildPlan がいつも出発の MEET_LEAD_MINUTES 分前を出すので、ずらさない（保存すると、出発について来なくなる）
  if (key === ORIGIN_KEY && savedAt(MEET_KEY) !== undefined && minutes < meet) stopTimes[MEET_KEY] = Math.max(0, minutes - lead)
  return stopTimes
}
