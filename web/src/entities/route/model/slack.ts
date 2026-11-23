// 拡張子つきで読むのは、テスト（scripts/web.test.mjs）が Node でそのまま読み込むため
import { lodgingStopIds } from './lodging.ts'
import type { Route, RouteStop, RouteStyle } from './types'

// しおりの空いた時間（ゆとり）の計算。Functions の domain/slack.ts と同じ決め。片方を変えたら、同じ PR でもう片方も合わせる（#520）

/** 1 日の予定を入れる終わりの時刻（0 時からの分。Functions の domain/routePlan.ts の DAY_END_MINUTES） */
export const DAY_END_MINUTES = 19 * 60
/** 宿に着く目安の時刻（Functions の LODGING_ARRIVE_MINUTES） */
export const LODGING_ARRIVE_MINUTES = 19 * 60
/** 提案で埋めるのは、空きがこれ以上ある日（Functions の FILL_MIN_MINUTES） */
export const FILL_MIN_MINUTES = 120
/** しおりに「ゆとり」の行を出すのは、空きがこれ以上あるとき（短い空きは、移動のずれに吸われるので出さない。実装した AI が仮に選んだ） */
export const SLACK_SHOWN_MINUTES = 30

/** 案ごとの 1 日の始まり（Functions の STYLE_TIMINGS の startMinutes） */
const DAY_START: Record<RouteStyle, number> = { shortest: 9 * 60, relaxed: 10 * 60, wishes: 9 * 60 }

/** 1 日の空いた時間 */
export interface DaySlack {
  /** 何日目か（1 日目が 1） */
  day: number
  /** 空きが始まる時刻（0 時からの分） */
  from: number
  /** 空きが終わる時刻（0 時からの分）。ふつうは 19 時。宿・夜景へ向かう前、旅の最後は出発地へ帰る前まで */
  to: number
  /** 空きの長さ（分）。from から to まで */
  minutes: number
  /** その日に場所の行が 1 つもない */
  empty: boolean
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** 0 時からの分を「16:30」にする */
export function clockOf(minutes: number): string {
  const capped = Math.max(0, Math.min(minutes, 23 * 60 + 59))
  return `${String(Math.floor(capped / 60)).padStart(2, '0')}:${String(capped % 60).padStart(2, '0')}`
}

/**
 * しおりの日ごとの空いた時間。1 日目から days 日目まで、1 日に 1 つ返す（Functions の daySlacks と同じ決め）。
 * - その日の最後に続く宿と夜景の行の前の、最後の場所を出てから、宿なら宿に 19 時に着く移動の前、夜景なら夜景へ向かう前まで
 * - 夜の行がなければ 19 時まで。旅の最後の日は、19 時から出発地へ帰る移動を引いた時刻まで（最後の場所が前の日でも）
 * - 夜の行しかない日は、その最初の行に着く時刻から
 * - 行のない日は、その日の始まりから 19 時までが全部空き
 */
export function daySlacks(route: Pick<Route, 'schedule' | 'lodging' | 'style'>, days: number): DaySlack[] {
  const start = DAY_START[route.style] ?? DAY_START.shortest
  const stayIds = new Set(lodgingStopIds(route))
  const places = route.schedule.filter((stop) => stop.pinId !== null)
  const isStay = (stop: RouteStop) => stayIds.has(stop.stopId ?? stop.pinId ?? '')
  const isNight = (stop: RouteStop) => stop.evening === true || isStay(stop)
  const result: DaySlack[] = []
  const lastDayOfTrip = Math.max(1, days)
  // 出発地へ帰る移動。帰るのは旅の最後の日なので、その日だけ 19 時から引く
  const homeMinutes = places.at(-1)?.returnMinutes ?? 0
  for (let day = 1; day <= lastDayOfTrip; day += 1) {
    const stops = places.filter((stop) => stop.day === day)
    const dayEnd = DAY_END_MINUTES - (day === lastDayOfTrip ? homeMinutes : 0)
    if (stops.length === 0) {
      result.push({ day, from: start, to: dayEnd, minutes: Math.max(0, dayEnd - start), empty: true })
      continue
    }
    let split = stops.length
    while (split > 0 && isNight(stops[split - 1])) split -= 1
    const lastDay = stops[split - 1] as RouteStop | undefined
    const night = stops[split] as RouteStop | undefined
    const moveIn = lastDay ? (lastDay.moveMinutesToNext ?? 0) : 0
    const from = lastDay ? minutesOf(lastDay.time) + lastDay.stayMinutes : minutesOf((night as RouteStop).time)
    const to = night
      ? (isStay(night) ? LODGING_ARRIVE_MINUTES : minutesOf(night.time)) - moveIn
      : dayEnd
    result.push({ day, from, to, minutes: Math.max(0, to - from), empty: false })
  }
  return result
}

/** しおりに出すゆとり（空きが SLACK_SHOWN_MINUTES 以上の日だけ）。days は旅の日数 */
export function shownSlacks(route: Pick<Route, 'schedule' | 'lodging' | 'style'>, days: number): DaySlack[] {
  return daySlacks(route, days).filter((slack) => slack.minutes >= SLACK_SHOWN_MINUTES)
}
