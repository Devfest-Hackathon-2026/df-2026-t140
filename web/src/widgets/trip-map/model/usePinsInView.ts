import { useMemo } from 'react'
import { type Pin, pinsInView } from '@/entities/pin'
import type { WithId } from '@/shared/api'
import { type MapView, type Size, visibleCorners } from '../lib/mercator'

/**
 * 地図に出すピン。前の検索の候補（灰色のピン）は、見えている所（上の帯と下のシートのあいだ）がまるごとその場所の近くに
 * 収まるまで寄ったら出す（かめの決定、2026-11-23。entities/pin の PAST_PIN_RADIUS_KM と pinsInView）。
 * shown は面が最後に知らせてきた見え方（useMapCamera）。まだないあいだは絞らない
 */
export function usePinsInView(
  pins: WithId<Pin>[],
  options: { currentWishId: string | null | undefined; selectedId: string | null; shown: { view: MapView; size: Size } | null; topInset: number; bottomInset: number },
): readonly WithId<Pin>[] {
  const { currentWishId, selectedId, shown, topInset, bottomInset } = options
  const corners = useMemo(
    () => (shown ? visibleCorners(shown.view, shown.size, topInset, bottomInset) : null),
    [shown, topInset, bottomInset],
  )
  return useMemo(() => pinsInView(pins, { currentWishId, selectedId, corners }), [pins, currentWishId, selectedId, corners])
}
