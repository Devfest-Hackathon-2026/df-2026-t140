import { useEffect, useEffectEvent, useState } from 'react'

export interface Subscribed<T> {
  /** まだ届いていない間は undefined */
  data: T | undefined
  loading: boolean
  error: Error | undefined
  /** 初回・キャッシュ・再接続の同期ではfalse。接続中の新しい変更だけtrue。 */
  live: boolean
}

type Subscribe<T> = (onData: (data: T, live?: boolean) => void, onError: (error: Error) => void) => () => void

const LOADING = { data: undefined, loading: true, error: undefined, live: false }

/**
 * onSnapshot のような「届くたびに呼ばれる」ものを、React の状態にする。
 * key が変わったら、つなぎ直す。key には、誰が何を読むか（uid、旅の ID など）を入れる。
 */
export function useSubscription<T>(key: string, subscribe: Subscribe<T>): Subscribed<T> {
  // どの key で届いたものかを一緒に持ち、key が変わった直後に前のデータを出さないようにする
  const [received, setReceived] = useState<{ key: string; value: Subscribed<T> }>()
  const start = useEffectEvent(subscribe)

  useEffect(
    () =>
      start(
        (data, live = false) => setReceived({ key, value: { data, loading: false, error: undefined, live } }),
        (error) => setReceived({ key, value: { data: undefined, loading: false, error, live: false } }),
      ),
    [key],
  )

  return received?.key === key ? received.value : LOADING
}
