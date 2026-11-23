import { useMyAiAccess } from '@/entities/ai-access'
import { useMyMemberships } from '@/entities/member'
import { isConfirmed, isPastTrip, type Trip, useTrips } from '@/entities/trip'
import type { WithId } from '@/shared/api'
import { useLinkOutcomeNotice } from '@/features/link-google'
import { recallLastTrip, today } from '@/shared/lib'

const NO_MEMBERSHIPS: never[] = []

/**
 * ホームに出すもの：自分が参加している旅（計画中の旅と、決まったしおりに分ける）、さっきまで開いていた旅、本物の AI を使えるか。
 * 発案者が旅程を確定した旅は、計画中の旅から外して、決まったしおりに並べる（企画書「ユーザー体験」3-6。2026-11-21、#502）。
 * 前の形で「決定」になった旅も、確定の印がなければ計画中の旅に並ぶ。
 * 確定した旅のうち、最終日を過ぎたものは、決まったしおりから外して、過去の旅に並べる（企画書「ユーザー体験」4-1。2026-11-21）
 */
export function useMenu() {
  // Google のログインの画面から戻ってきたところなら、結果を知らせる
  useLinkOutcomeNotice()
  const memberships = useMyMemberships()
  const aiAccess = useMyAiAccess()
  const all = memberships.data ?? NO_MEMBERSHIPS
  const trips = useTrips(all.map(({ tripId }) => tripId))
  const date = today()
  const finals: WithId<Trip>[] = []
  const pasts: WithId<Trip>[] = []
  for (const { tripId } of all) {
    const trip = trips.data?.[tripId]
    if (!trip || !isConfirmed(trip)) continue
    if (isPastTrip(trip, date)) pasts.push(trip)
    else finals.push(trip)
  }
  // 過去の旅は、新しい旅を上にする
  pasts.sort((a, b) => (b.endDate ?? b.startDate).localeCompare(a.endDate ?? a.startDate))
  return {
    // 合言葉の記録が届く前に「合言葉を知っている人へ」を一瞬出さないよう、どちらも待つ。
    // 旅が計画中の旅と決まったしおりのどちらに入るかが分かるまでも待つ（一覧の中で旅が飛び移らないように）
    loading: memberships.loading || aiAccess.loading || (all.length > 0 && trips.loading),
    failed: Boolean(memberships.error),
    trips: all.filter(({ tripId }) => !isConfirmed(trips.data?.[tripId])),
    finals,
    pasts,
    /** 参加している旅があるか（計画中でも、決まったものでも） */
    hasTrips: all.length > 0,
    currentTripId: recallLastTrip(),
    // 読めないとき（電波がない、ルールの誤り）は「使えない」と同じ扱い
    aiUnlocked: aiAccess.data === true,
  }
}
