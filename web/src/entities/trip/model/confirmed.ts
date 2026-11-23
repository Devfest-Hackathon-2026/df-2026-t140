import type { Trip } from './types'

/**
 * 旅程が確定しているか（企画書「ユーザー体験」3-6）。確定しているあいだは、建物と行程を変えず、地図は見るだけ。
 * 前の形で「決定」になった旅（status が decided）も、確定の印がなければ確定していない。Functions 側は functions/src/domain/trip.ts
 */
export function isConfirmed(trip: Pick<Trip, 'confirmed'> | null | undefined): boolean {
  return Boolean(trip?.confirmed)
}

/**
 * 過去の旅か（企画書「ユーザー体験」4-1）。確定していて、最終日（終了日。日帰りは開始日）が today より前の旅。
 * 最終日の当日は、まだ過去の旅ではない。確定していない旅は、最終日を過ぎても過去の旅にしない。
 * today は YYYY-MM-DD（shared/lib の today()）。日付は文字のまま比べる（どちらも YYYY-MM-DD なので、順番が合う）
 */
export function isPastTrip(trip: Pick<Trip, 'confirmed' | 'startDate' | 'endDate'> | null | undefined, today: string): boolean {
  if (!trip || !isConfirmed(trip)) return false
  return (trip.endDate ?? trip.startDate) < today
}
