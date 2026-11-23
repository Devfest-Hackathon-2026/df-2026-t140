// Firestore のデータの型：trips/{tripId}/wishes/{wishId}
// Functions 側の同じ型は functions/src/domain/wish.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：本人が作る。状態を進めるのは Functions
import type { Timestamp } from 'firebase/firestore'

/** 希望を書いたときに地図で映していた範囲 */
export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

/**
 * pending：書いた直後（端末が書けるのはこれだけ）。searching：Functions が引き受けて場所を探している。
 * done：ピンが立った。failed：探せなかった。
 */
export type WishStatus = 'pending' | 'searching' | 'done' | 'failed'

export interface Wish {
  uid: string
  /** 「温泉に入りたい」など。1〜100 文字 */
  text: string
  /** 探す範囲。地図がまだ出ていないときは null */
  bounds: MapBounds | null
  status: WishStatus
  /** しおりの何日目の夜の宿を探しているか（1 日目の夜が 1）。「宿を探す」から書いた希望にだけある。Functions が宿さがしとして扱う */
  lodgingNight?: number
  /** しおりのどの日のどのごはんのお店を探しているか（「1-lunch」）。ごはんの枠の「お店を探す」から書いた希望にだけある */
  mealSlot?: string
  /**
   * 探しても候補がなかった理由（status が failed のときだけ。Functions が書く）。
   * event：時刻が決まったイベントを探したが、旅の日程のあいだに、この辺りで開催されるものがなかった（#581）
   */
  notFound?: 'event'
  createdAt: Timestamp
}

// 長さの上限は firestore.rules と合わせる
export const WISH_TEXT_MAX = 100
