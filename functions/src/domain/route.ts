// Firestore のデータの型：trips/{tripId}/routes/{routeId}
// 画面側の同じ型は web/src/entities/route/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ
import type { TimestampLike } from './timestamp'

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
  /** 移動時間の合計（分）。直線距離から計算した、おおよその目安（domain/routePlan.ts） */
  totalMoveMinutes: number
  /** 直線距離の合計（km） */
  totalDistanceKm: number
  /** 出発地の位置が分かり、出発地からの移動を入れたか。false なら、1 つ目の場所から始まる */
  originIncluded: boolean
  /** 案を作ったもの。stub は自分たちの計算（本物の Gemini ではない）。画面でそう分かるようにする */
  proposedBy: 'stub' | 'agy' | 'vertex'
  /** 何回目に作った案か。建物が増えて作り直すたびに 1 増える（前の案と票は消す） */
  generation: number
  /** 決まったあとに組み直した回数。案として出したときは 0 */
  revision: number
  /** 決まったあとに足した場所（ピンの ID。足した順）。投票はやり直さず、全員が承認済みとみなす */
  addedPinIds: string[]
  createdAt: TimestampLike
  updatedAt: TimestampLike
}

/** ルート案を出すのに要る、建った場所の数（2026-11-07 にルート案と投票をやめる前の決め。古い旅の扱いとテストのために残す） */
export const MIN_PLACES_FOR_ROUTES = 3

/**
 * しおりのルートの ID。2026-11-07 にルート案と投票をやめ、建った場所がしおりに旅の順で並ぶ形にした
 * （企画書「ユーザー体験」2-4、3）。計画中の旅は、建物が 1 つ建ったときにこの 1 本を作り、建つたびに足す。
 * ルートが決まった旅（前の形で投票まで済んだもの）は、決まったルート（decidedRouteId）をしおりにする
 */
export const SHIORI_ROUTE_ID = 'shiori'

/** しおりのルートを作るのに要る、建った場所の数 */
export const MIN_PLACES_FOR_SHIORI = 1
