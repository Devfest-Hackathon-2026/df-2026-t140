// Firestore のデータの型：trips/{tripId}/wishes/{wishId}
// 画面側の同じ型は web/src/entities/wish/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：本人が作る。状態を進めるのは Functions
import { parseMealKey } from './meal'
import type { TimestampLike } from './timestamp'

/** 希望を書いたときに地図で映していた範囲 */
export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * pending：書かれた直後（端末が書けるのはこれだけ）。searching：Functions が引き受けて場所を探している。
 * done：ピンが立った。failed：探せなかった。
 * pending → searching は、同じ希望を 2 回処理しないための目印（features/suggest-places/usecase.ts）。
 */
export type WishStatus = 'pending' | 'searching' | 'done' | 'failed'

export interface Wish {
  uid: string
  /** 「温泉に入りたい」など。1〜100 文字 */
  text: string
  /** 探す範囲。地図がまだ出ていないときは null */
  bounds: MapBounds | null
  status: WishStatus
  /**
   * しおりの何日目の夜の宿を探しているか（1 日目の夜が 1）。しおりの宿の枠や検索欄の上の「宿を探す」から書いた希望にだけある。
   * あると、宿さがしとして扱い、候補のピンにこの夜を写す
   */
  lodgingNight?: number
  /**
   * しおりのどの日のどのごはんのお店を探しているか（「1-lunch」。domain/meal.ts の mealKey）。しおりのごはんの枠の「お店を探す」から書いた希望にだけある。
   * あると、食べるお店だけを探し、候補のピンにこの枠を写す
   */
  mealSlot?: string
  /**
   * 探しても候補がなかった理由（status が failed のときだけ。Functions だけが書く）。
   * event：時刻が決まったイベント（花火大会、見学会）を探したが、旅の日程のあいだに、この辺りで開催されるものがなかった（#581）
   */
  notFound?: 'event'
  createdAt: TimestampLike
}

/** 泊まる夜として受け取る数の上限（firestore.rules と合わせる） */
export const LODGING_NIGHT_MAX = 30

/** 希望に書かれた「何日目の夜の宿か」。決まった形（1 〜 LODGING_NIGHT_MAX の整数）でなければ null */
export function lodgingNightOf(wish: Pick<Wish, 'lodgingNight'>): number | null {
  const night = wish.lodgingNight
  return typeof night === 'number' && Number.isInteger(night) && night >= 1 && night <= LODGING_NIGHT_MAX ? night : null
}

/** 希望に書かれた「どの日のどのごはんか」（「1-lunch」）。決まった形でなければ null */
export function mealSlotOf(wish: Pick<Wish, 'mealSlot'>): string | null {
  return parseMealKey(wish.mealSlot) ? wish.mealSlot! : null
}
