import { useMyAiAccess } from '@/entities/ai-access'
import { useMyMemberships } from '@/entities/member'
import { recallLastTrip } from '@/shared/lib'

/** ホームに出すもの：自分が参加している旅、さっきまで開いていた旅、本物の AI を使えるか */
export function useMenu() {
  const memberships = useMyMemberships()
  const aiAccess = useMyAiAccess()
  return {
    // 合言葉の記録が届く前に「合言葉を知っている人へ」を一瞬出さないよう、どちらも待つ
    loading: memberships.loading || aiAccess.loading,
    failed: Boolean(memberships.error),
    trips: memberships.data ?? [],
    currentTripId: recallLastTrip(),
    // 読めないとき（電波がない、ルールの誤り）は「使えない」と同じ扱い
    aiUnlocked: aiAccess.data === true,
  }
}
