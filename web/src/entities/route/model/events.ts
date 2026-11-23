import type { RouteStop } from './types'

// しおりの時刻が決まったイベント（花火大会、見学会。#581）が、今のしおりで守れているか（純粋）。
// Functions 側の同じ決めは functions/src/domain/routePlan.ts の buildPlan（EventCheck）。片方を変えたら、もう片方も合わせる。
// 画面は保存したしおり（schedule）から見分ける（Functions は守れているかを保存しない）

/** イベントの開催の日時（entities/pin の PinEvent のうち、ここで使うもの） */
export interface EventTimes {
  /** 開催日（YYYY-MM-DD） */
  date: string
  start: number
  end: number
}

/**
 * イベントの行の困りごと。day：開催日と違う日に並んでいる。late：前の予定から移動すると、着いておく時刻に間に合わない。
 * overlap：次の予定に、イベントを出て移動し終わるより前に着くことになっている
 */
export type EventIssue = 'day' | 'late' | 'overlap'

const utc = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** startDate を 1 日目としたときの、date が何日目か */
export function eventDayNumber(date: string, startDate: string): number {
  return Math.round((utc(date) - utc(startDate)) / 86_400_000) + 1
}

/** 行の時刻（HH:MM）を 0 時からの分に。読めなければ null（scripts/web.test.mjs が別名の import なしで読めるよう、ここで計算する） */
const minutesOf = (stop: RouteStop): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(stop.time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * しおりのイベントの行（stop）の困りごと。なければ null。複数あるときは day、late、overlap の順に 1 つ。
 * - 前の行（同じ日。集合場所の行も含む）を、その行にいる時間のあとに出て移動すると、イベントの行の時刻より遅く着く → late
 *   （Functions は前の行にいる時間を 0 分まで縮めてもイベントの時刻を守るので、縮めきれない分が遅れとして残る）
 * - 次の行（同じ日）に、イベントの行を出て移動し終わるより早く着く → overlap
 * - それより後ろの行（同じ日）に、イベントが終わるより早く着く → overlap（Functions の buildPlan と同じ決め）
 */
export function eventIssueOf(schedule: readonly RouteStop[], stop: RouteStop, event: EventTimes, startDate: string): EventIssue | null {
  if (stop.day !== eventDayNumber(event.date, startDate)) return 'day'
  const index = schedule.indexOf(stop)
  const at = minutesOf(stop)
  if (index < 0 || at === null) return null
  const previous = schedule[index - 1]
  const previousAt = previous ? minutesOf(previous) : null
  if (previous && previous.day === stop.day && previousAt !== null && previousAt + previous.stayMinutes + (previous.moveMinutesToNext ?? 0) > at) return 'late'
  const next = schedule[index + 1]
  const nextAt = next ? minutesOf(next) : null
  if (next && next.day === stop.day && nextAt !== null && at + stop.stayMinutes + (stop.moveMinutesToNext ?? 0) > nextAt) return 'overlap'
  const leave = at + stop.stayMinutes
  const later = schedule.slice(index + 2).filter((item) => item.day === stop.day)
  if (later.some((item) => (minutesOf(item) ?? Infinity) < leave)) return 'overlap'
  return null
}
