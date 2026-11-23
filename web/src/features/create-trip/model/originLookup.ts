import type { OriginLookup, OriginPoint } from '@/entities/trip'

// 出発地を引く処理を、名前ごとに 1 回だけにする仕組み（旅をつくる画面の決定・つぎへ・出発のどれから呼んでも同じ結果を使う）。
// 型のほかは何も読み込まない（テストからそのまま呼べるように）

/** 出発地を引いた結果。通信に失敗したときは error */
export type OriginResult = OriginLookup | { status: 'error' }

/**
 * 名前から位置を引く関数を作る。known は表から引く（関数を呼ばない）。fetch は出発地の関数（Places）を呼ぶ。
 * 同じ名前は、引いている途中も、見つからなかったときも含めて引き直さない。通信の失敗だけは覚えず、次に呼んだときに引き直す
 */
export function memoOriginLookup(
  known: (name: string) => { lat: number; lng: number } | null,
  fetch: (name: string) => Promise<OriginLookup>,
): (name: string) => Promise<OriginResult> {
  const asked = new Map<string, Promise<OriginResult>>()
  return (name) => {
    const location = known(name)
    if (location) return Promise.resolve({ status: 'resolved', point: { name, location, placeId: null } satisfies OriginPoint })
    const before = asked.get(name)
    if (before) return before
    const job: Promise<OriginResult> = fetch(name)
      .then((found): OriginResult => (found.status === 'resolved' ? { status: 'resolved', point: { ...found.point, name } } : found))
      .catch((): OriginResult => {
        asked.delete(name)
        return { status: 'error' }
      })
    asked.set(name, job)
    return job
  }
}
