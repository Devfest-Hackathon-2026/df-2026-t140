// 左右のスワイプで、前後へ移る判定。場所の情報（S12）と場所カード（S05）で共通。純粋な関数だけ（scripts/web.test.mjs で確かめる）

/** 横に動かした距離がこれ以上で、縦より十分に大きいときだけ、スワイプとみなす（px） */
const SWIPE_MIN_PX = 56
/** 横の動きが縦の何倍以上ならスワイプか（斜めや縦のスクロールを取り違えない） */
const SWIPE_RATIO = 1.5

/**
 * 指やマウスの動きから、どちらへ移るかを決める。右から左へ動かすと次、左から右へ動かすと前
 * （写真をめくるのと同じ向き。ヨウキンが 2026-11-07 に決めた。企画書の「実装で仮に決めたこと」）。
 * スワイプでなければ null
 */
export function swipeTarget(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null
  return dx < 0 ? 'next' : 'prev'
}
