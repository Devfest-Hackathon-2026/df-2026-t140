// Firestore のデータの型：trips/{tripId}/routes/{routeId}
// Functions 側の同じ型は functions/src/domain/route.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ
import type { Timestamp } from 'firebase/firestore'
import type { GeminiProvider } from '@/shared/lib'

/**
 * 区間ごとに選べる移動手段（電車・バス、車、徒歩、飛行機）。Functions 側は functions/src/domain/travelMode.ts の LegMode。
 * 飛行機は直線 200 km より遠い区間だけ（#424）
 */
export type LegMode = 'transit' | 'car' | 'walk' | 'plane'

/**
 * 飛行機の区間の行き方（ルートの legFlights）。Functions 側は functions/src/domain/flight.ts の LegFlight。
 * flight は時刻表（公共交通オープンデータセンター）から選んだ便。目安のときは null
 */
export interface LegFlight {
  minutes: number
  flight: {
    numbers: string[]
    airline: string
    from: { code: string; name: string }
    to: { code: string; name: string }
    dep: string
    arr: string
  } | null
  /** 時刻表の取得日時（ISO8601）。目安のときは null */
  fetchedAt: string | null
  /** 便を決めたときの区間の出発時刻（0 時からの分）と、旅の何日目か（Functions が組み直しで便を外すかの判断に使う） */
  departAt?: number
  day?: number
  /** 乗れる便がなく目安にしたとき、その日の最終便（Functions の domain/flight.ts の lastFlight） */
  lastFlight?: {
    airline: string
    number: string
    from: { code: string; name: string }
    to: { code: string; name: string }
    dep: string
    arriveAirportBy: string
  }
}

/** スケジュールの 1 行。日ごとに、時刻、場所、滞在時間、次への移動を並べる */
export interface RouteStop {
  /** 1 日目が 1 */
  day: number
  /** HH:MM */
  time: string
  /** 出発地など、ピンのない行は null */
  pinId: string | null
  /**
   * 行の ID。同じ場所を何度も訪れるしおりで、複製した行（2 回目からの訪問）にだけある（「ピンの ID~番号」）。
   * ない行の ID は、ピンの ID（model/visits.ts の stopIdOf）
   */
  stopId?: string
  name: string
  stayMinutes: number
  /** 次の行までの移動時間。最後の行は null */
  moveMinutesToNext: number | null
  /**
   * 集合時間（HH:MM）。1 日目の集合場所（出発地）の行だけにある。この行の time は出発時間。
   * 人が決めていなければ、出発の 15 分前。前の形の行にはない（そのときは画面で 15 分前を出す。model/stopTimes.ts）
   */
  meetTime?: string
  /** 夜に置いた行（夜景）。ゆとりは、この行へ向かう前までで数える（Functions の domain/route.ts。#602） */
  evening?: boolean
  /** 出発地へ帰る移動の目安（分）。しおりの最後の場所の行だけにある。最後の日のゆとりを、19 時からこの分を引いた時刻までにする */
  returnMinutes?: number
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
  catchphraseEn?: string
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
  /**
   * しおりの移動の行で、区間ごとに選んだ手段（キーは「どこから>どこへ」。出発地は @origin）。選んでいない区間は旅全体の手段。
   * Functions だけが書く（features/change-leg-mode）。前の形にはない
   */
  legModes?: Record<string, LegMode>
  /** 飛行機の区間の行き方（キーは legModes と同じ）。Functions だけが書く（features/change-leg-mode） */
  legFlights?: Record<string, LegFlight>
  /**
   * しおりで人が直した時刻（0 時からの分）。キーは、集合時間が @meet、出発地を出る時間が @origin、場所に着く時刻がその場所のピンの ID。
   * Functions だけが書く（features/set-stop-time）。組み直すたびに守る。前の形にはない
   */
  stopTimes?: Record<string, number>
  /**
   * 泊まる夜ごとの宿（キーは何日目の夜か。1 日目の夜が "1"）。値は、宿に決めた建物のピンの ID か、宿を取らない夜の LODGING_SKIP（model/lodging.ts）。
   * キーのない夜は、まだ決めていない（しおりに点線の枠を出す）。Functions だけが書く（features/propose-routes、features/set-lodging）。前の形にはない
   */
  lodging?: Record<string, string>
  /**
   * 日程や時間に入りきらず、しおりから外した場所（ピンの ID。外した順）。建物は地図に残る。一覧は出さず、その建物の場所カードにだけ「しおりに戻す」を出す
   * （features/restore-place。バグ30）。Functions だけが書く（features/change-trip-dates、features/propose-routes、features/restore-place）。前の形にはない
   */
  leftOutPinIds?: string[]
  /**
   * 日ごとの朝・昼・晩ごはんの枠（キーは「1-lunch」の形。model/meal.ts）。値は、建てたお店のピンの ID か、お店を建てずに決めた MEAL_SKIP（「@skip:コンビニ」）。
   * キーのない枠と、お店がしおりからなくなった枠は、まだ決めていない。Functions だけが書く（features/propose-routes、features/set-meal）。前の形にはない
   */
  meals?: Record<string, string>
  createdAt: Timestamp
  updatedAt: Timestamp
}
