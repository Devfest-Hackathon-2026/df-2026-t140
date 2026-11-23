// Firestore のデータの型：trips/{tripId}
// 画面側の同じ型は web/src/entities/trip/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：旅のメンバー（状態と決定したルートは Functions だけ）
import type { TimestampLike } from './timestamp'
import type { TravelMode } from './travelMode'
import type { OriginPoint } from './tripOrigin'

/** 計画中 → 決定。今は決定にする操作がない。前の形（全員の投票、発案者のしおりの確定）で決まった旅だけが決定のまま残る */
export type TripStatus = 'planning' | 'decided'

/** 大まかな場所（地方）の ID。画面側の web/src/entities/trip/model/regions.ts の REGION_IDS と合わせる */
export type RegionId =
  | 'hokkaido'
  | 'tohoku'
  | 'kanto'
  | 'koshinetsu'
  | 'hokuriku'
  | 'tokai'
  | 'kinki'
  | 'chugoku'
  | 'shikoku'
  | 'kyushu'
  | 'okinawa'

/** 旅程を確定した人と時刻 */
export interface TripConfirmation {
  uid: string
  at: TimestampLike
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
  originPoint?: OriginPoint
  /** 旅の最後にいたい場所（帰る場所）の名前。出発地と違うときだけある（ないときは出発地へ帰る）。作るときだけ書ける */
  returnTo?: string
  returnPoint?: OriginPoint
  /** 大まかな場所（地方）。旅を作った人が作るときに選ぶ。2026-11-16 より前に作った旅にはない */
  regions?: RegionId[]
  /** 県まで絞ったときだけ、選んだ県の名前（「長野県」） */
  prefectures?: string[]
  /** 移動手段（domain/travelMode.ts）。前からある旅にはない（車として扱う） */
  travelMode?: TravelMode
  status: TripStatus
  /** 決定したルート。計画中は null。Functions だけが書く */
  decidedRouteId: string | null
  createdBy: string
  /**
   * 旅の合言葉（domain/joinCode.ts）。Functions だけが書く（features/join-code）。
   * 招待の画面を最初に開いたときに作るので、それまではない
   */
  joinCode?: string
  /**
   * 旅程の確定（features/confirm-shiori）。発案者（domain/tripOwner.ts）が確定するとあり、取り消すと消える。
   * 確定しているあいだは、建物と行程を変えない（発案者だけは時刻を直せる）。Functions だけが書く。
   * 旅の状態（status）の「決定」とは別のもの。前の形で決定になった旅も、これがなければ確定していない
   */
  confirmed?: TripConfirmation
  createdAt: TimestampLike
  updatedAt: TimestampLike
}

/** 旅程が確定しているか（確定しているあいだは、建物と行程を変えない） */
export function isConfirmed(trip: Pick<Trip, 'confirmed'>): boolean {
  return Boolean(trip.confirmed)
}
