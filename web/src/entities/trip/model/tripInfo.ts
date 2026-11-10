import { monthDayLabel, nightsLabel } from '@/shared/lib'
import type { Trip } from './types'

/** 画面で入力する旅の基本情報（S01）。行き先は入れない（みんなで決める） */
export type TripInfo = Pick<Trip, 'title' | 'startDate' | 'endDate' | 'origin'>

// 長さの上限は firestore.rules と合わせる
export const TRIP_TITLE_MAX = 40
export const TRIP_ORIGIN_MAX = 40

/** 余分な空白を落とし、終了日が開始日と同じなら日帰り（null）にそろえる */
export function normalizeTripInfo(info: TripInfo): TripInfo {
  return {
    title: info.title.trim(),
    startDate: info.startDate,
    endDate: info.endDate && info.endDate !== info.startDate ? info.endDate : null,
    origin: info.origin.trim(),
  }
}

/** 入力に足りないところがあれば、画面に出す文を返す。よければ null */
export function tripInfoProblem(info: TripInfo): string | null {
  const { title, startDate, endDate, origin } = normalizeTripInfo(info)
  if (!title) return '旅のタイトルを入れてください'
  if (title.length > TRIP_TITLE_MAX) return `タイトルは ${TRIP_TITLE_MAX} 文字までです`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '開始日を選んでください'
  if (endDate && endDate < startDate) return '終了日は開始日より後にしてください'
  if (!origin) return '出発地を入れてください'
  if (origin.length > TRIP_ORIGIN_MAX) return `出発地は ${TRIP_ORIGIN_MAX} 文字までです`
  return null
}

/** 「1泊2日・11/21（土）・東京駅発」 */
export function tripSummary(trip: TripInfo): string {
  return `${nightsLabel(trip.startDate, trip.endDate)}・${monthDayLabel(trip.startDate)}・${trip.origin}発`
}

/**
 * 開始日を変える。終了日より後にしたときは、終了日をいったん外す（日帰りに戻す）。
 * 終了日が開始日より前のままになるのを防ぐ。
 */
export function withStartDate(info: TripInfo, startDate: string): TripInfo {
  const endDate = info.endDate && info.endDate < startDate ? null : info.endDate
  return { ...info, startDate, endDate }
}

/** 終了日を変える。空にしたら日帰り（null） */
export function withEndDate(info: TripInfo, endDate: string): TripInfo {
  return { ...info, endDate: endDate || null }
}

/** 「日帰り」「1泊2日」。開始日がまだ入っていなければ null */
export function tripNightsLabel(info: TripInfo): string | null {
  return info.startDate ? nightsLabel(info.startDate, info.endDate) : null
}
