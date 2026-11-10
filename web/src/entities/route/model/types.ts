// Firestore のデータの型：trips/{tripId}/routes/{routeId}
// Functions 側の同じ型は functions/src/domain/route.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ
import type { Timestamp } from 'firebase/firestore'
import type { GeminiProvider } from '@/shared/lib'

/** スケジュールの 1 行。日ごとに、時刻、場所、滞在時間、次への移動を並べる */
export interface RouteStop {
  /** 1 日目が 1 */
  day: number
  /** HH:MM */
  time: string
  /** 出発地など、ピンのない行は null */
  pinId: string | null
  name: string
  stayMinutes: number
  /** 次の行までの移動時間。最後の行は null */
  moveMinutesToNext: number | null
}

/**
 * 案の種類。3 つの案は、ここが違う。
 * shortest：移動がいちばん短い順。relaxed：滞在を長く、出発を遅く。wishes：全員の希望が早めに 1 つずつ入る順。
 */
export type RouteStyle = 'shortest' | 'relaxed' | 'wishes'

export interface Route {
  /** 「A」「B」「C」 */
  label: string
  style: RouteStyle
  /** 「奥信州で秋を堪能する旅」など */
  catchphrase: string
  /** 回る順番 */
  pinIds: string[]
  schedule: RouteStop[]
  /** 移動時間の合計（分）。保存してあるのは直線距離からの目安（Routes の時間は保存しない。useShioriTravel） */
  totalMoveMinutes: number
  /** 直線距離の合計（km） */
  totalDistanceKm: number
  /** 出発地の位置が分かり、出発地からの移動を入れたか。false なら、1 つ目の場所から始まる */
  originIncluded: boolean
  /** 案を作ったもの。stub は自分たちの計算（本物の Gemini ではない）。画面でそう分かるようにする */
  proposedBy: GeminiProvider
  /** 何回目に作った案か。建物が増えて作り直すたびに 1 増える（前の案と票は消える） */
  generation: number
  /** 決まったあとに組み直した回数。案として出したときは 0 */
  revision: number
  /** 決まったあとに足した場所（ピンの ID。足した順）。投票はやり直さず、全員が承認済みとみなす */
  addedPinIds: string[]
  createdAt: Timestamp
  updatedAt: Timestamp
}
