// 下から出るシート（しおり、場所の情報）の動きの段階を決める。純粋な関数だけ（React を使わない。scripts/web.test.mjs で確かめる）

/**
 * シートが出てきた理由。'open' は画面の下から上がる（しおりを開いた、しおりや建物から場所の情報を開いた）、
 * 'switch' は小さく動くだけ（場所の情報で、しおりの前後の場所へ移った）
 */
export type SheetEntrance = 'open' | 'switch'

/**
 * シートの動きの段階。開いた状態の動き（open、switch、expand）、開いて止まった状態（rest）、
 * 閉じる途中（closing）、閉じて上の部分だけになった状態（peek）
 */
export type SheetPhase = SheetEntrance | 'expand' | 'rest' | 'closing' | 'peek'

/** 動きを終えて落ち着いた形。閉じた状態か、開いた状態か。出てきたばかりで動きの途中なら null */
export type SheetSettled = 'peek' | 'full' | null

/**
 * いま閉じた状態にしたいか（peek）と、最後に動きを終えた形（settled）から、段階を決める。
 * 2 つが食い違っている間が、閉じる途中・開く途中。動きを減らす設定では、閉じるときに動きを待たない
 */
export function sheetPhase(peek: boolean, settled: SheetSettled, entrance: SheetEntrance, reducedMotion: boolean): SheetPhase {
  if (peek) return settled === 'peek' || reducedMotion ? 'peek' : 'closing'
  if (settled === 'peek') return 'expand'
  if (settled === 'full') return 'rest'
  return entrance
}

/** シートの動きが終わったときに、落ち着いた形として覚える値 */
export function settledAfterAnimation(peek: boolean): Exclude<SheetSettled, null> {
  return peek ? 'peek' : 'full'
}
