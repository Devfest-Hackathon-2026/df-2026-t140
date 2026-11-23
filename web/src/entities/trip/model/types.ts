// Firestore のデータの型：trips/{tripId}
// Functions 側の同じ型は functions/src/domain/trip.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：旅のメンバー（状態と決定したルートは Functions だけ）
import type { Timestamp } from 'firebase/firestore'
import type { RegionId } from './regions'

/** 計画中 → 決定。今は決定にする操作がない。前の形（全員の投票、発案者のしおりの確定）で決まった旅だけが決定のまま残る */
export type TripStatus = 'planning' | 'decided'

/** 旅程を確定した人と時刻（Functions だけが書く。features/confirm-shiori） */
export interface TripConfirmation {
  uid: string
  at: Timestamp
}

export interface Trip {
  /** 1〜40 文字 */
  title: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD。null は日帰り */
  endDate: string | null
  /** 出発地（集合場所）の名前。1〜40 文字 */
  origin: string
  originPoint?: import('./originPoint').OriginPoint
  /**
   * 旅の最後にいたい場所（帰る場所）の名前。作る人が出発地と違う場所を選んだときだけある（ないときは出発地へ帰る）。
   * しおりの最後の日の、帰る移動の目安に使う（Takana の依頼、2026-11-22）。作るときだけ書ける
   */
  returnTo?: string
  returnPoint?: import('./originPoint').OriginPoint
  /**
   * 大まかな場所（地方）。旅を作った人が作るときに 1 つ以上選ぶ（model/regions.ts）。
   * 地方を選ぶ画面を足す前（2026-11-16 より前）に作った旅にはない
   */
  regions?: RegionId[]
  /** 県まで絞ったときだけ、選んだ県の名前（「長野県」）。地方を丸ごと選んだときはない（model/regions.ts の toTripArea） */
  prefectures?: string[]
  /** 移動手段（model/travelMode.ts）。前からある旅にはない（車として扱う）。選び直すのは Functions だけ */
  travelMode?: import('./travelMode').TravelMode
  status: TripStatus
  /** 決定したルート。計画中は null。Functions だけが書く */
  decidedRouteId: string | null
  createdBy: string
  /**
   * 旅の合言葉（model/joinCode.ts）。Functions だけが書く。
   * 旅を作った直後に頼み始める（features/create-trip）。届くまでと、前からある旅で招待の画面をまだ開いていないあいだはない
   */
  joinCode?: string
  /**
   * 旅程の確定。発案者（entities/member の ownerUidOf）が確定するとあり、取り消すと消える（model/confirmed.ts）。
   * 確定しているあいだは、建物と行程を変えない（発案者だけは時刻を直せる）。状態（status）の「決定」とは別のもの
   */
  confirmed?: TripConfirmation
  createdAt: Timestamp
  updatedAt: Timestamp
}
