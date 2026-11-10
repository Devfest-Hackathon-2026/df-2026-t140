// 口コミを何で聞くかの決め。React と Firebase に依存しない（node のテストから読む）

/**
 * そのピンの口コミを何で聞くか。Places で確かめた場所は place_id、まだ確かめていない候補（と建築に失敗したピン）は 'candidate'
 * （Functions が名前で探す。functions/src/features/place-reviews/usecase.ts と同じ条件）。聞かないピンは null。
 * 覚えた答えはこの値ごとに分ける（候補のときの答えを、建てたあとの場所の情報に使わない）
 */
export function reviewsAsk(pin: { placeId: string | null; status: string }): string | null {
  if (pin.placeId) return pin.placeId
  return pin.status === 'candidate' || pin.status === 'failed' ? 'candidate' : null
}
