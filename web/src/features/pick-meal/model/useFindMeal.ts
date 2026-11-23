import { useState } from 'react'
import { MEAL_WISH_LABELS, type MealKind, mealKey, mealSearchBounds, type RouteStop } from '@/entities/route'
import { addWish, type MapBounds } from '@/entities/wish'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'

interface Target {
  tripId: string
  /** しおりの行（どの日にどの場所を回るか、何時に着くか） */
  schedule: readonly Pick<RouteStop, 'day' | 'time' | 'pinId' | 'stopId'>[]
  /** 宿に決まった建物のピンの ID（その日の場所に数えない） */
  stayIds: readonly string[]
  /** ピンの ID から位置を引く */
  locationOf: (pinId: string) => { lat: number; lng: number } | undefined
  /** いま地図で映している範囲。しおりに場所がないときに、ここから探す */
  getBounds: () => MapBounds | null
}

/** お店さがしで書く希望の文（場所カードの題とお知らせに出る） */
export function mealWishText(day: number, meal: MealKind): string {
  // 共有のデータ（希望の文）なので、画面の言語によらず日本語で書く。画面では mealSlotLabel で言語に合わせて出す
  return `${day} 日目の${MEAL_WISH_LABELS[meal]}`
}

/**
 * 「お店を探す」（企画書「ユーザー体験」3-7 の 8）。押すとすぐ、その枠のお店を探す希望を書く。
 * 探す範囲は、その日にその時間ごろいる場所のまわり（entities/route の mealSearchBounds）。お店を探して候補のピンを立てるのは Functions で、
 * 建てると、しおりのその日のそのごはんの位置に入る。書けたら true を返す
 */
export function useFindMeal({ tripId, schedule, stayIds, locationOf, getBounds }: Target) {
  const session = useSession()
  const toast = useToast()
  const [finding, setFinding] = useState(false)

  async function find(day: number, meal: MealKind): Promise<boolean> {
    if (finding) return false
    prepareSounds()
    playSound('send')
    setFinding(true)
    try {
      const bounds = mealSearchBounds(schedule, day, meal, locationOf, stayIds) ?? getBounds()
      await addWish(session, tripId, mealWishText(day, meal), bounds, undefined, mealKey(day, meal))
      return true
    } catch {
      playSound('error')
      toast(translate('お店を探せませんでした。電波のよいところで、もう一度押してください。', 'Could not search for restaurants. Check your connection and try again.'))
      return false
    } finally {
      setFinding(false)
    }
  }

  return { find, finding }
}
