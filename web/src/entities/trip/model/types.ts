// Firestore のデータの型：trips/{tripId}
// Functions 側の同じ型は functions/src/domain/trip.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：旅のメンバー（状態と決定したルートは Functions だけ）
import type { Timestamp } from 'firebase/firestore'

/** 計画中 → 決定。全員が投票すると Functions が決定にする */
export type TripStatus = 'planning' | 'decided'

export interface Trip {
  /** 1〜40 文字 */
  title: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD。null は日帰り */
  endDate: string | null
  /** 出発地（集合場所）の名前。1〜40 文字 */
  origin: string
  status: TripStatus
  /** 決定したルート。計画中は null。Functions だけが書く */
  decidedRouteId: string | null
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
