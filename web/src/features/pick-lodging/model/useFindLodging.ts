import { useState } from 'react'
import { lodgingSearchBounds, type RouteStop } from '@/entities/route'
import { addWish, type MapBounds } from '@/entities/wish'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'

interface Target {
  tripId: string
  /** しおりの行（どの日にどの場所を回るか） */
  schedule: readonly Pick<RouteStop, 'day' | 'pinId'>[]
  /** 宿に決まった建物のピンの ID（前後の場所に数えない） */
  stayIds: readonly string[]
  /** ピンの ID から位置を引く */
  locationOf: (pinId: string) => { lat: number; lng: number } | undefined
  /** いま地図で映している範囲。しおりに場所がないときに、ここから探す */
  getBounds: () => MapBounds | null
}

/** 宿さがしで書く希望の文（場所カードの題とお知らせに出る） */
export function lodgingWishText(night: number): string {
  return `${night} 日目の宿`
}

/**
 * 「宿を探す」（企画書「ユーザー体験」2-5、3-7）。押すとすぐ、その夜の宿を探す希望を書く。
 * 探す範囲は、その日の最後の場所と翌日の最初の場所のあいだ（entities/route の lodgingSearchBounds）。場所を探して候補のピンを立てるのは Functions で、
 * 探している間は上の帯の下の行に「1 日目の宿を探し中です」と出て、立つと、みんなの地図がその候補へ動く（pages/trip-map の useTripMap）。書けたら true を返す
 */
export function useFindLodging({ tripId, schedule, stayIds, locationOf, getBounds }: Target) {
  const session = useSession()
  const toast = useToast()
  const [finding, setFinding] = useState(false)

  async function find(night: number): Promise<boolean> {
    if (finding) return false
    prepareSounds()
    playSound('send')
    setFinding(true)
    try {
      const bounds = lodgingSearchBounds(schedule, night, locationOf, stayIds) ?? getBounds()
      await addWish(session, tripId, lodgingWishText(night), bounds, night)
      return true
    } catch {
      playSound('error')
      toast(translate('宿を探せませんでした。電波のよいところで、もう一度押してください。', "Couldn't search for lodging. Check your connection and try again."))
      return false
    } finally {
      setFinding(false)
    }
  }

  return { find, finding }
}
