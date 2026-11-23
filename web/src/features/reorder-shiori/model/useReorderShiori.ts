import { useState } from 'react'
import type { Route } from '@/entities/route'
import { useSession, type WithId } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { reorderShiori } from '../api/reorderShiori'
import { type PendingMove, movedRoute } from './move'

/**
 * しおりの行を、落とした位置に差し込む操作（企画書「ユーザー体験」3-6）。
 * 頼んだらすぐ、行を動かしたしおりを出し（route）、Functions が時刻と日を計算し直したしおりが届いたら、そちらに替わる。
 * 動かせなかったときは元に戻し、お知らせを出す。保存を待つあいだは、次の移動を受けない
 */
export function useReorderShiori(tripId: string, route: WithId<Route> | null) {
  const session = useSession()
  const toast = useToast()
  const [pending, setPending] = useState<PendingMove | null>(null)
  const revision = route?.revision ?? 0
  // 新しいしおりが届いた（組み直しの回数が変わった）ら、待っている移動は済んだもの
  const waiting = pending && pending.revision === revision ? pending : null

  function move(fromPinId: string, toPinId: string) {
    if (!route || waiting || fromPinId === toPinId) return
    const asked = { from: fromPinId, to: toPinId, revision }
    playSound('switch')
    setPending(asked)
    reorderShiori(session, tripId, route.id, fromPinId, toPinId).catch(() => {
      setPending((current) => (current === asked ? null : current))
      playSound('error')
      toast(translate('順番を入れ替えられませんでした。もう一度試してください', "Couldn't reorder the stops. Try again."))
    })
  }

  return { route: route ? movedRoute(route, waiting) : null, move }
}
