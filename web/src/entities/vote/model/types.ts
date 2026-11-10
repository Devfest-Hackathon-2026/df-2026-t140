// Firestore のデータの型：trips/{tripId}/routes/{routeId}/votes/{uid}
// Functions 側の同じ型は functions/src/domain/vote.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：本人だけ。1 人 1 票（members の votedRouteId と同じ書き込みでそろえる）
import type { Timestamp } from 'firebase/firestore'

export interface Vote {
  uid: string
  createdAt: Timestamp
}
