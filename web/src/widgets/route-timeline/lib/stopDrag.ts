// しおりの行を取り（指は長押し、マウスはドラッグ）、行と行のあいだに落として差し込む操作の、純粋な決め（画面なしで試せる。scripts/web.test.mjs）。

/** これだけ押し続けたら、行が取れる（ms） */
export const LONG_PRESS_MS = 400
/** 取れる前にこれより指が動いたら、長押しではなくスクロールとみなす（px） */
export const PRESS_SLOP_PX = 8
/** 落とさずに離したとき、取った行が元の場所へ戻る動きの長さ（ms。RouteTimeline.module.css の .returning と合わせる） */
export const RETURN_MS = 200
/** しおりの欄の上下の端からこの範囲に指があると、欄をそちらへ動かす（px） */
const EDGE_PX = 56
/** 端にいちばん近いときに、1 コマで動かす量（px） */
const MAX_SCROLL_STEP_PX = 12

/** 落とせる行 1 つの、画面の縦の範囲 */
export interface RowBand {
  pinId: string
  top: number
  bottom: number
}

/** 取れる前に、指が動きすぎたか */
export function pressMovedTooFar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > PRESS_SLOP_PX
}

/** 落とす先。to の行の位置に差し込む。線は to の行の上（after が false）か下（true）に出す */
export interface DropSlot {
  to: string
  after: boolean
}

/**
 * 指の高さ（y）で、いま落とすと差し込まれる位置（行と行のあいだ。ノートブックのセルを動かすときと同じ）。
 * 行の縦の真ん中を過ぎたら、その行の下に入る。下へ動かすときは、すぐ上の行の下に線を出し、その行の位置に入る（あいだの行は上へずれる）。
 * 上へ動かすときは、すぐ下の行の上に線を出し、その行の位置に入る（あいだの行は下へずれる）。
 * 取っている行のすぐ上とすぐ下（動かしても順番が変わらない位置）と、取っている行が見つからないときは null
 */
export function insertionAt(y: number, bands: readonly RowBand[], dragging: string): DropSlot | null {
  const rows = [...bands].sort((left, right) => left.top - right.top)
  const from = rows.findIndex((band) => band.pinId === dragging)
  if (from < 0) return null
  // 上から数えて、いくつ目の行の前に入るか（rows.length なら、いちばん下）
  const slot = rows.filter((band) => y >= (band.top + band.bottom) / 2).length
  if (slot === from || slot === from + 1) return null
  return slot > from ? { to: rows[slot - 1].pinId, after: true } : { to: rows[slot].pinId, after: false }
}

/** 指がしおりの欄の上下の端に近いとき、欄を動かす量（px、上は負）。端から遠ければ 0 */
export function autoScrollStep(y: number, top: number, bottom: number): number {
  if (y < top + EDGE_PX) return -Math.round(MAX_SCROLL_STEP_PX * Math.min(1, (top + EDGE_PX - y) / EDGE_PX))
  if (y > bottom - EDGE_PX) return Math.round(MAX_SCROLL_STEP_PX * Math.min(1, (y - (bottom - EDGE_PX)) / EDGE_PX))
  return 0
}
