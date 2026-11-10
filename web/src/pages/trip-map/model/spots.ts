// しおりの場所の情報（S12）で、左右のスワイプで回る並びの決め（#226）。純粋な関数だけ（scripts/web.test.mjs で確かめる）。
// node --test から直接読むため、ほかのファイルを import しない。

/**
 * 集合場所を開いているときの、URL の place の値。ピンの ID（Firestore の自動の ID。英数字 20 文字）とはぶつからない。
 * Functions がしおりの道の形で出発地に使う印（@origin）とそろえた
 */
export const ORIGIN_SPOT = '@origin'

/**
 * 場所の情報で回る並び：集合場所、そのあとにしおりの順の建物。
 * 集合場所は建物ではないので、建物の数や番号、旅程には入れない（並びの先頭に置くだけ）
 */
export function spotOrder(stopIds: readonly string[]): string[] {
  return [ORIGIN_SPOT, ...stopIds]
}

/**
 * 並びの中で、今の場所の前と次。端なら null（一周しない）。今の場所が並びになければ null
 */
export function spotNeighbors(order: readonly string[], current: string): { prev: string | null; next: string | null } | null {
  const index = order.indexOf(current)
  if (index < 0) return null
  return { prev: order[index - 1] ?? null, next: order[index + 1] ?? null }
}
