// Firestore のデータの型：trips/{tripId}/members/{uid}
// Functions 側の同じ型は functions/src/domain/member.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：本人だけ
import type { Timestamp } from 'firebase/firestore'

export interface Member {
  uid: string
  /** 1〜20 文字 */
  displayName: string
  /** 個人の色。#RRGGBB */
  color: string
  /** 投票したルート。未投票は null。routes/{routeId}/votes/{uid} と必ずそろう（ルールで強制） */
  votedRouteId: string | null
  joinedAt: Timestamp
}
