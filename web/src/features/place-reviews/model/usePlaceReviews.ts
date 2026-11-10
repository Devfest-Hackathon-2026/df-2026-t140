import { useEffect, useState } from 'react'
import { useSession } from '@/shared/api'
import { fetchPlaceReviews, type PlaceReviews } from '../api/placeReviews'
import { remember, type ReviewsState, reviewsState } from './reviewsMemory'

export type { ReviewsState }

/**
 * 届いた口コミ（場所 → 口コミ）。ページのメモリーにだけ持ち、保存はしない（規約で口コミは保存できない）。
 * 出せなかった答え（合言葉の前、失敗）は覚えない。あとで合言葉を通したり、失敗が直ったりしたら、広げ直したときに出る。
 * 出せないときは Functions が Places を呼ばないので、聞き直しても上限は減らない（失敗は Places の 1 回に数えることがある）。
 * 再読み込みで消える。場所の情報のシートは上の部分だけ（peek）にすると作り直されるので、シートの外に持ち、
 * 広げ直しても Places を聞き直さない（1 日の上限のため）
 */
const remembered = new Map<string, PlaceReviews>()
/** 聞いている途中の答え。口コミと写真の 2 つの部品が同じ場所を同時に聞いても、Places は 1 回で済ませる */
const pending = new Map<string, Promise<PlaceReviews | null>>()

function askOnce(session: Parameters<typeof fetchPlaceReviews>[0], key: string, tripId: string, pinId: string): Promise<PlaceReviews | null> {
  const running = pending.get(key)
  if (running) return running
  const request = fetchPlaceReviews(session, tripId, pinId)
    .catch(() => null)
    .finally(() => pending.delete(key))
  pending.set(key, request)
  return request
}

/**
 * 場所の情報（S12）を開いている間だけ、その場所の口コミを聞く。
 * 聞き方（ask：確かめた場所の place_id か、候補なら 'candidate'。model/ask.ts の reviewsAsk）があるときだけ聞く。
 * 覚えた答えは聞き方ごとに分ける（候補のときの答えを、建てたあとの場所の情報に使わない）。別の場所に切り替えたら、前の答えは使わない。
 * 同じ場所の答えがあれば聞き直さない
 */
export function usePlaceReviews(tripId: string, pinId: string, ask: string | null, active: boolean): ReviewsState {
  const session = useSession()
  const askable = ask !== null
  const key = `${session.uid}/${tripId}/${pinId}/${ask ?? ''}`
  // 今の場所に届いた答え（出せなければ data は null）。届いたら必ず描き直す（新しい object なので）
  const [answer, setAnswer] = useState<{ key: string; data: PlaceReviews | null } | null>(null)

  useEffect(() => {
    if (!active || !askable || remembered.has(key)) return
    let live = true
    const settle = (data: PlaceReviews | null) => {
      remember(remembered, key, data)
      if (live) setAnswer({ key, data })
    }
    void askOnce(session, key, tripId, pinId).then(settle)
    return () => {
      live = false
      // 閉じたら答えを外す。出せなかった場所を広げ直すと、聞き直すあいだは「読み込み中」になる
      setAnswer(null)
    }
  }, [session, key, tripId, pinId, askable, active])

  return reviewsState(remembered, key, answer, active, askable)
}
