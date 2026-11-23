// チュートリアルの、タップで進む向きと、移ったあとの番号を決める判定。純粋な関数だけ（scripts/web.test.mjs で確かめる）

export type Move = 'next' | 'prev'

/** 指がこれ以上動いたら、タップとはみなさない（px） */
const TAP_MAX_PX = 10
/** 画面の左からこの割合までを押すと、前へ戻る。それより右は次へ進む（画面全体を左右の半分に分ける。Takana の依頼、2026-11-22） */
const PREV_ZONE = 0.5

/**
 * スワイプではなかった動きが、タップならどちらへ移るかを決める。
 * ほとんど動いていなければタップで、離した所が画面の左半分なら前、右半分なら次。動いていれば（縦や斜めに引いた）null。
 * 前の 1 枚がない（最初の 1 枚）ときは、どこを押しても次（左半分を押しても何も起きない、とならないように）
 *
 * @param xRatio 離した所の、画面の左端からの割合（0〜1）
 * @param canGoBack 前の 1 枚があるか
 */
export function tapMove(dx: number, dy: number, xRatio: number, canGoBack = true): Move | null {
  if (Math.hypot(dx, dy) > TAP_MAX_PX) return null
  return canGoBack && xRatio < PREV_ZONE ? 'prev' : 'next'
}

/**
 * 移ったあとの番号。最後の 1 枚から次へ進むと 'done'（チュートリアルを終える）。最初の 1 枚から前へは動かない
 */
export function stepAfter(index: number, count: number, move: Move): number | 'done' {
  if (move === 'prev') return Math.max(0, index - 1)
  return index + 1 >= count ? 'done' : index + 1
}
