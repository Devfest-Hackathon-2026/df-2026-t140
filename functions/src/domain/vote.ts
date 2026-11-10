// Firestore のデータの型：trips/{tripId}/routes/{routeId}/votes/{uid}
// 画面側の同じ型は web/src/entities/vote/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：本人だけ。1 人 1 票（members の votedRouteId と同じ書き込みでそろえる）
import type { TimestampLike } from './timestamp'

export interface Vote {
  uid: string
  createdAt: TimestampLike
}
