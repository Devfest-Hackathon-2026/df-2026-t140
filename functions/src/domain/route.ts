// Firestore のデータの型：trips/{tripId}/routes/{routeId}
// 画面側の同じ型は web/src/entities/route/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ
import type { TimestampLike } from './timestamp'
import type { LegFlight } from './flight'
import type { LegMode } from './travelMode'

/** スケジュールの 1 行。日ごとに、時刻、場所、滞在時間、次への移動を並べる */
export interface RouteStop {
  /** 1 日目が 1 */
  day: number
  /** HH:MM */
  time: string
  /** 出発地など、ピンのない行は null */
  pinId: string | null
  /**
   * 行の ID。同じ場所を何度も訪れるしおりで、複製した行（2 回目からの訪問）にだけある（「ピンの ID~番号」。domain/visit.ts）。
   * ない行の ID は、ピンの ID。時刻を直す、区間の手段を選ぶ、順番を入れ替えるときは、行の ID で指す
   */
  stopId?: string
  name: string
  stayMinutes: number
  /** 次の行までの移動時間。最後の行は null */
  moveMinutesToNext: number | null
  /**
   * 集合時間（HH:MM）。1 日目の集合場所（出発地）の行だけにある。この行の time は出発時間。
   * 人が決めていなければ、出発の 15 分前（domain/routePlan.ts の MEET_LEAD_MINUTES）。前の形の行にはない
   */
  meetTime?: string
  /** 夜に置いた行（夜景）。日の入りのあとに着くようにした。ゆとりは、この行へ向かう前までで数える（domain/slack.ts。#602） */
  evening?: boolean
  /**
   * 出発地へ帰る移動の目安（分）。旅のしおりの最後の場所の行だけにある（宿の行が最後なら、ない）。帰りの行はしおりに出さず、
   * 最後の日のゆとりを、19 時からこの分を引いた時刻までにする（#602）
   */
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
  /** 回る順番。行の ID が並ぶ（ふつうはピンの ID。同じ場所を何度も訪れるときの 2 回目からは「ピンの ID~番号」。domain/visit.ts） */
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
  /**
   * しおりの移動の行で、区間ごとに選んだ手段（キーは「どこから>どこへ」。出発地は @origin）。選んでいない区間は旅全体の手段。
   * 順番を入れ替えてなくなった区間の分は、組み直すときに外す（domain/routePlan.ts の buildPlan）。前の形にはない
   */
  legModes?: Record<string, LegMode>
  /**
   * 飛行機の区間の行き方（便と所要時間。キーは legModes と同じ）。飛行機を選んだときに時刻表から決めて残し、組み直すときはこの所要時間を使う。
   * 便の要約だけで、時刻表そのものは残さない（ODPT 基本ライセンス 第8条。domain/flight.ts）
   */
  legFlights?: Record<string, LegFlight>
  /**
   * しおりで人が直した時刻（0 時からの分）。キーは、集合時間が @meet、出発地を出る時間が @origin、場所に着く時刻がその行の ID、場所を出る時刻が行の ID@leave（domain/visit.ts）。
   * 組み直すたびに守る（domain/routePlan.ts の buildPlan）。直していない時刻は自動で組む。
   * Functions だけが書く（features/set-stop-time）。前の形にはない
   */
  stopTimes?: Record<string, number>
  /**
   * 泊まる夜ごとの宿（キーは何日目の夜か。1 日目の夜が "1"）。値は、宿に決めた建物のピンの ID か、宿を取らない夜の印（LODGING_SKIP。自分で書いた過ごし方があれば「@skip:車中泊」の形。lodgingSkipValue）。
   * キーのない夜は、まだ決めていない（しおりに点線の枠が出る）。宿のピンは pinIds にも入り、その日の最後の行になる
   * （domain/routePlan.ts の splitByNights）。Functions だけが書く（features/propose-routes、features/set-lodging）。前の形にはない
   */
  lodging?: Record<string, string>
  /**
   * しおりから外した場所（ピンの ID。外した順）。日程を縮めて入りきらなかった場所（features/change-trip-dates）と、
   * 建った場所を足すとしおりが時間に収まらず外した場所（features/propose-routes、domain/dropToFit.ts。#622）。建物は地図に残る。
   * 一覧は画面に出さない（Lazyturtle0852 の決定、2026-11-22）。その建物の場所カードにだけ「しおりに戻す」を出す（features/restore-place。Takana の決定、2026-11-23、バグ30）。
   * あとで建った場所をしおりに足すとき（features/propose-routes）も、確定の前の確かめ（features/confirm-shiori）でも数えない。
   * 日程を変えると、時間に収まる場所は自動でしおりに戻る（features/change-trip-dates）。建物を消す（features/remove-building）と外れる。
   * Functions だけが書く（features/change-trip-dates、features/propose-routes、features/restore-place）。前の形にはない
   */
  leftOutPinIds?: string[]
  /**
   * 日ごとの朝・昼・晩ごはんの枠（キーは「日-食事」。「1-lunch」。domain/meal.ts の mealKey）。値は、建てたお店のピンの ID か、
   * お店を建てずに決めた印（MEAL_SKIP。書いた言葉があれば「@skip:コンビニ」の形）。キーのない枠と、お店がしおりからなくなった枠は、まだ決めていない
   * （しおりに点線の枠が出る）。Functions だけが書く（features/propose-routes、features/set-meal）。前の形にはない
   */
  meals?: Record<string, string>
  createdAt: TimestampLike
  updatedAt: TimestampLike
}

/** Route.lodging の値で、その夜は宿を取らない（「自分で書く」で決めた）ことを表す印。ピンの ID とは重ならない */
export const LODGING_SKIP = '@skip'

/** 宿を取らない夜に、自分で書ける過ごし方（「車中泊」「友だちの家」）の長さの上限 */
export const LODGING_NOTE_MAX = 20

/** Route.lodging の値が、宿を取らない夜の印か（過ごし方が書いてあっても、なくても） */
export function isLodgingSkip(value: string | undefined): boolean {
  return value === LODGING_SKIP || (typeof value === 'string' && value.startsWith(`${LODGING_SKIP}:`))
}

/** 宿を取らない夜の印。note（自分で書いた過ごし方）があれば「@skip:車中泊」、なければ「@skip」 */
export function lodgingSkipValue(note: string | null | undefined): string {
  const text = (note ?? '').trim().slice(0, LODGING_NOTE_MAX)
  return text ? `${LODGING_SKIP}:${text}` : LODGING_SKIP
}

/**
 * 宿がまだ決まっていない夜（1 日目の夜が 1。早い順）。days は旅の日数（日帰りは 1 で、泊まる夜はない）。
 * 宿の建物が決まっている夜（そのピンが回る順番にある）と、宿を取らないと決めた夜は、決まっているとみなす。
 * 1 つでも残っていると、旅程を確定できない（企画書「ユーザー体験」3-7）。画面側は web/src/entities/route/model/lodging.ts の openLodgingNight
 */
export function openLodgingNights(route: Pick<Route, 'lodging' | 'pinIds'>, days: number): number[] {
  const open: number[] = []
  for (let night = 1; night < days; night += 1) {
    const value = route.lodging?.[String(night)]
    if (!isLodgingSkip(value) && !(value !== undefined && route.pinIds.includes(value))) open.push(night)
  }
  return open
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
