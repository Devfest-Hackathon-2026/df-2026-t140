import { useEffect, useRef, useState } from 'react'
import { useSession, type WithId } from '@/shared/api'
import { fetchShioriTravel, type ShioriTravel } from '../api/travel'
import type { Route } from './types'

/** しおりの中身を表す文字。場所の並びか組み直しの回数が変わったら、聞き直す */
const contentKey = (route: Pick<WithId<Route>, 'id' | 'revision' | 'pinIds'>) => `${route.id}|${route.revision ?? 0}|${route.pinIds.join(',')}`

/**
 * しおりを開いている間だけ、Routes API（車）の移動時間で計算し直したスケジュールを聞く。
 * しおりの中身が変わったときに 1 回だけ聞く。聞けない・断られたとき（本番で合言葉を通していない、開発環境など）は null。
 * 規約で Routes の時間は保存できないので、この部品のメモリーにだけ持ち、画面を離れたら捨てる
 */
export function useShioriTravel(tripId: string, route: WithId<Route> | null, active: boolean): ShioriTravel | null {
  const session = useSession()
  const [answer, setAnswer] = useState<{ key: string; travel: ShioriTravel | null } | null>(null)
  // 聞いた（聞いている途中の）中身。同じ中身では聞き直さない（Routes の 1 日の上限を余分に使わない）
  const asked = useRef<string | null>(null)
  const key = route ? contentKey(route) : null
  const routeId = route?.id ?? null
  const revision = route?.revision ?? 0
  const pinIds = route?.pinIds.join(',') ?? ''

  useEffect(() => {
    if (!active || !routeId || !key || asked.current === key) return
    asked.current = key
    // 画面を離れたあとに届いた答えは使わない
    const request = { live: true, done: false }
    fetchShioriTravel(session, tripId, routeId)
      .then((travel) => {
        request.done = true
        // 聞いている間にしおりが変わっていたら使わない（並びと回数が、聞いたときと同じものだけ）
        const same = travel && travel.revision === revision && travel.pinIds.join(',') === pinIds
        if (request.live) setAnswer({ key, travel: same ? travel : null })
        // 離れたあとに届いた答えは捨てる。次に開いたときにもう一度聞く
        else if (asked.current === key) asked.current = null
      })
      .catch(() => {
        request.done = true
        // 聞けなければ、保存してある目安のまま。同じ中身では聞き直さない
        if (request.live) setAnswer({ key, travel: null })
      })
    return () => {
      request.live = false
      // 答えが届く前に離れたら、次に開いたときにもう一度聞けるようにする（届いていれば、同じ中身では聞き直さない）
      if (!request.done && asked.current === key) asked.current = null
    }
  }, [active, key, pinIds, revision, routeId, session, tripId])

  return answer && answer.key === key ? answer.travel : null
}
