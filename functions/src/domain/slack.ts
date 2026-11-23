// しおりの空いた時間（ゆとり）の計算（純粋。I/O なし）。#520。
// 画面側の同じ計算は web/src/entities/route/model/slack.ts。片方を変えたら、同じ PR でもう片方も合わせる
import { isLodgingSkip, type Route, type RouteStop } from './route'
import { DAY_END_MINUTES, LODGING_ARRIVE_MINUTES } from './routePlan'

/** 提案で埋めるのは、空きがこれ以上ある日（Takana の決定、2026-11-21。todo/humans/2026-11-21-shiori-slack-and-suggestions.md） */
export const FILL_MIN_MINUTES = 120
/** 提案を入れても、その日に残すゆとり（同じ決め。1 日に最低 1〜2 時間を残す） */
export const KEEP_SLACK_MINUTES = 60

/** 1 日の空いた時間 */
export interface DaySlack {
  /** 何日目か（1 日目が 1） */
  day: number
  /** 空きが始まる時刻（0 時からの分）。その日の最後の昼の場所を出る時刻 */
  from: number
  /** 空きが終わる時刻（0 時からの分）。ふつうは 19 時。宿・夜景へ向かう前、旅の最後は出発地へ帰る前まで（#602） */
  to: number
  /** 空きの長さ（分）。from から to まで。0 のこともある */
  minutes: number
  /** 空きの近くの場所（その日の最後の昼の場所。行のない日は前の日の最後か、次の日の最初）のピンの ID。場所がなければ null */
  anchorPinId: string | null
  /** その日に場所の行が 1 つもない */
  empty: boolean
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/**
 * しおりの日ごとの空いた時間。1 日目から days 日目まで、1 日に 1 つ返す。
 * - その日の最後に続く宿と夜景（evening）の行を「夜の行」とし、空きは、その前の最後の場所を出てから
 *   - 夜の行の最初が宿なら、宿への移動を引いて宿に 19 時（LODGING_ARRIVE_MINUTES）に着く時刻まで
 *   - 夜の行の最初が夜景なら、夜景へ向かう移動を始める時刻まで
 *   - 夜の行がなければ 19 時まで
 * - 旅の最後の日（days 日目）は、19 時の代わりに、19 時から出発地へ帰る移動（最後の場所の行の returnMinutes）を引いた時刻まで。
 *   最後の場所がそれより前の日でも、帰るのは最後の日とみなす
 * - 夜の行しかない日は、その最初の行に着く時刻から数える（宿へ・夜景への移動は引かない）
 * - 場所と場所のあいだは、行が続いているので空きにしない
 * - 行のない日は、その日の始まり（startMinutes）から 19 時までが全部空き
 */
export function daySlacks(route: Pick<Route, 'schedule' | 'lodging'>, days: number, startMinutes: number): DaySlack[] {
  const stayIds = new Set(Object.values(route.lodging ?? {}).filter((value) => !isLodgingSkip(value)))
  const places = route.schedule.filter((stop) => stop.pinId !== null)
  const isNight = (stop: RouteStop) => stop.evening === true || stayIds.has(stop.stopId ?? stop.pinId ?? '')
  const isStay = (stop: RouteStop) => stayIds.has(stop.stopId ?? stop.pinId ?? '')
  const result: DaySlack[] = []
  const lastDayOfTrip = Math.max(1, days)
  // 出発地へ帰る移動。帰るのは旅の最後の日なので、その日だけ 19 時から引く（最後の場所が前の日でも、帰るのは最後の日）
  const homeMinutes = places.at(-1)?.returnMinutes ?? 0
  for (let day = 1; day <= lastDayOfTrip; day += 1) {
    const stops = places.filter((stop) => stop.day === day)
    const dayEnd = DAY_END_MINUTES - (day === lastDayOfTrip ? homeMinutes : 0)
    if (stops.length === 0) {
      const before = places.filter((stop) => stop.day < day).at(-1)
      const after = places.find((stop) => stop.day > day)
      result.push({ day, from: startMinutes, to: dayEnd, minutes: Math.max(0, dayEnd - startMinutes), anchorPinId: (before ?? after)?.pinId ?? null, empty: true })
      continue
    }
    let split = stops.length
    while (split > 0 && isNight(stops[split - 1])) split -= 1
    const daytime = stops.slice(0, split)
    const lastDay = daytime.at(-1)
    const night = stops[split]
    const moveIn = lastDay ? (lastDay.moveMinutesToNext ?? 0) : 0
    const from = lastDay ? minutesOf(lastDay.time) + lastDay.stayMinutes : minutesOf(night.time)
    const to = night
      ? (isStay(night) ? LODGING_ARRIVE_MINUTES : minutesOf(night.time)) - moveIn
      : dayEnd
    result.push({ day, from, to, minutes: Math.max(0, to - from), anchorPinId: (lastDay ?? night).pinId, empty: false })
  }
  return result
}
