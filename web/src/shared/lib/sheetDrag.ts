// 下のシートを取っ手でドラッグして開け閉めするときの判定。純粋な関数だけ（scripts/web.test.mjs で確かめる）。
// 一般的な下のシートと同じ動き：指についてシートが動き、離すと近い止まる高さ（全部開く・上の部分だけ）へ吸い付く。
// 取っ手を軽く押すと開く・閉じるが切り替わる（Apple の HIG の取っ手と同じ）

/** シートが止まる高さ。全部開いた状態か、上の部分だけ残した閉じた状態か */
export type SheetRest = 'full' | 'peek'

/** これより動かなければ、ドラッグではなく押しただけとみなす（px） */
const TAP_SLOP_PX = 6
/** 動ける範囲のこの割合を超えて動かしたら、向こうの状態へ移す */
const SETTLE_RATIO = 0.3
/** 範囲が小さいときも、少なくともこれだけ動かしたら移す（px） */
const SETTLE_MIN_PX = 40
/** これより速くはじいたら、短い距離でもその向きへ移す（px/ms。下向きが正） */
const FLICK_SPEED = 0.5
/** はじいたとみなすのに、少なくとも動かす距離（px） */
const FLICK_MIN_PX = 12

/**
 * ドラッグ中にシートを動かす量（px。下向きが正）。全部開いた状態からは下へだけ、閉じた状態からは上へだけ、
 * 2 つの止まる高さの差（range）までしか動かさない
 */
export function dragOffset(from: SheetRest, dy: number, range: number): number {
  const limit = Math.max(0, range)
  if (from === 'full') return Math.min(Math.max(dy, 0), limit)
  return Math.max(Math.min(dy, 0), -limit)
}

/**
 * 指を離したときに、どちらの止まる高さへ吸い付くかを決める。
 * dy は動かした距離（下向きが正）、velocity は離す直前の速さ（px/ms、下向きが正）、range は 2 つの止まる高さの差。
 * 押しただけ（ほとんど動かしていない）なら、開く・閉じるを切り替える
 */
export function dragSettle(from: SheetRest, dy: number, velocity: number, range: number): SheetRest {
  if (Math.abs(dy) < TAP_SLOP_PX) return from === 'full' ? 'peek' : 'full'
  const toward: SheetRest = from === 'full' ? 'peek' : 'full'
  // 向こうへ向かう向きに動かした量（全部開いた状態からは下へ、閉じた状態からは上へ）
  const sign = from === 'full' ? 1 : -1
  const moved = dy * sign
  const speed = velocity * sign
  if (moved >= FLICK_MIN_PX && speed >= FLICK_SPEED) return toward
  if (moved >= Math.max(SETTLE_MIN_PX, Math.max(0, range) * SETTLE_RATIO)) return toward
  return from
}

/**
 * 開いた状態のシートを、上へ引いて大きくするか（大きくできるシートだけ。場所の情報 S12）。
 * dy は動かした距離（下向きが正）。上へ SETTLE_MIN_PX 以上動かすか、上へはじいたら大きくする
 */
export function dragGrow(dy: number, velocity: number): boolean {
  const moved = -dy
  if (moved >= FLICK_MIN_PX && -velocity >= FLICK_SPEED) return true
  return moved >= SETTLE_MIN_PX
}

/**
 * 動かし始めの向き。TAP_SLOP_PX まで動いたところで、縦（シートの上げ下げ）か横（前後の場所へのスワイプ）かを決める。
 * まだ動きが小さければ null。縦と横が同じなら縦（取っ手は上げ下げのための所なので）
 */
export function dragAxis(dx: number, dy: number): 'vertical' | 'horizontal' | null {
  if (Math.hypot(dx, dy) < TAP_SLOP_PX) return null
  return Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal'
}

/**
 * 名前の行より下を畳むカード（場所カード S05）で、ドラッグ中に見せる畳む枠の開き具合（0 で畳んだ、1 で開いた）。
 * from は動かし始めの形、offset は useSheetDrag のずれ（下向きが正）、range は動ける範囲、
 * shown は開いた形で見えていた枠の高さの、中身全体の高さに対する割合（カードの上限で中身が切れていると 1 より小さい）
 */
export function foldOpenness(from: SheetRest, offset: number, range: number, shown: number): number {
  if (range <= 0) return from === 'full' ? shown : 0
  const visible = from === 'full' ? range - offset : -offset
  return Math.min(Math.max((visible / range) * shown, 0), 1)
}
