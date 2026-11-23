import { useState } from 'react'
import { useSession, type WithId } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { subscribeTrips } from '../api/trip'
import type { Trip } from './types'

type Trips = Record<string, WithId<Trip> | null>

/**
 * いくつかの旅を読み、どれかが変わるたびに描き直す。旅の ID ごとに、読めなかった旅は null。
 * 旅の並びは順番によらず同じ購読にする。参加している旅が増えたり減ったりしてつなぎ直すあいだは、
 * 前に届いた分を出し続ける（ホーム全体が読み込み中に戻らないように）。loading になるのは最初に読むときだけ
 */
export function useTrips(tripIds: readonly string[]): Subscribed<Trips> {
  const session = useSession()
  const ids = [...tripIds].sort()
  const current = useSubscription<Trips>(`${session.uid}/Trips/${ids.join(',')}`, (onData, onError) =>
    subscribeTrips(session, ids, onData, onError),
  )
  // 前に届いた分（React の「前の描画の値を覚えておく」書き方。描くあいだに 1 回だけ更新する）
  const [last, setLast] = useState<Trips | undefined>(undefined)
  // 旅がまだ 1 つもない（参加している旅の一覧を読む前の）空の結果は覚えない。覚えると、旅の状態が届く前に読み込み中が終わる
  if (current.data && ids.length > 0 && current.data !== last) setLast(current.data)
  if (current.loading && last) return { data: last, loading: false, error: undefined, live: false }
  return current
}
