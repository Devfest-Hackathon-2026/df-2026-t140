// 飛行機の区間の行き方（純粋。I/O なし）。区間の両端の近くの空港を組み合わせ、ANA・JAL の直行便から最も早く着く便を選ぶ。
// 時刻表は公共交通オープンデータセンター（ODPT）の odpt:FlightSchedule（adapters/odpt.ts が取ってくる）。
// 時刻表がないとき（キーがない、取れない、便がない）は、距離の式の目安にする。かめの決定、2026-11-18（#424）
import type { LatLng } from './pin'
import { groundMode, type LegMode, type TravelMode } from './travelMode'

/** 空港。code は IATA の 3 文字（HND など） */
export interface Airport {
  code: string
  name: string
  location: LatLng
}

/** 1 つの便。dep・arr は 0 時からの分（日をまたぐ到着は 1440 を足す） */
export interface FlightRun {
  /** 便名（共同運航なら複数。先頭が運航する会社の便名） */
  numbers: string[]
  /** 運航する会社（ANA、JAL など） */
  airline: string
  dep: number
  arr: number
  /** 時刻表が使える期間（YYYY-MM-DD。odpt:isValidFrom、odpt:isValidTo）。なければ期間の決めなし */
  validFrom?: string
  validTo?: string
}

/** 空港の組み合わせごとの時刻表。calendar は ODPT の曜日（Monday、Weekday、SaturdayHoliday など） */
export interface FlightRoute {
  from: string
  to: string
  calendar: string
  flights: FlightRun[]
}

export interface Timetable {
  airports: Airport[]
  routes: FlightRoute[]
  /** 取得日時（ISO8601）。画面に出す（ODPT のガイドライン 2.2.1） */
  fetchedAt: string
}

/** 飛行機を選べる区間の長さの下限（直線距離 km）。近い区間では飛行機を出さない（かめの決定、2026-11-18） */
export const PLANE_MIN_KM = 200
/**
 * 選ばなくても最初から飛行機にする区間（車や電車では行きにくい）。直線 PLANE_DEFAULT_KM 以上か、
 * 端のどちらかが北緯 ISLANDS_SOUTH_OF_LAT より南（奄美・沖縄・先島などの島。本土と陸路でつながらない）で PLANE_MIN_KM 以上。
 * かめの決定（2026-11-19、#465。「両方」）。600 km と北緯 30 度は AI が仮に選んだ。画面側の同じ決めは web/src/entities/route/model/legs.ts
 */
export const PLANE_DEFAULT_KM = 600
export const ISLANDS_SOUTH_OF_LAT = 30

export function planeByDefault(from: LatLng, to: LatLng): boolean {
  const distance = km(from, to)
  if (distance >= PLANE_DEFAULT_KM) return true
  return distance >= PLANE_MIN_KM && (from.lat < ISLANDS_SOUTH_OF_LAT || to.lat < ISLANDS_SOUTH_OF_LAT)
}

/**
 * 飛行機の旅で、最初から飛行機にする区間の長さの下限（直線距離 km）。これより近い区間は電車・バス（東京〜仙台・大阪は飛行機、
 * 現地の県どうしは電車・バス。300 km は実装した AI が仮に選んだ。Takana の依頼、2026-11-22）。画面側の同じ値は web/src/entities/route/model/legs.ts
 */
export const PLANE_TRIP_MIN_KM = 300

/** 区間の既定の手段。最初から飛行機にする区間なら飛行機、それ以外は旅全体の地上の手段（飛行機の旅は電車・バス） */
export function defaultLegMode(from: LatLng, to: LatLng, tripMode: TravelMode): LegMode {
  if (planeByDefault(from, to)) return 'plane'
  if (tripMode === 'plane' && km(from, to) >= PLANE_TRIP_MIN_KM) return 'plane'
  return groundMode(tripMode)
}

/** 区間の端から、乗り降りの候補にする空港までの距離（km）と、候補の数 */
const AIRPORT_RANGE_KM = 150
const AIRPORT_CANDIDATES = 3
/** 空港での手続きと待ち（分）、降りてから空港を出るまで（分） */
export const CHECK_IN_MINUTES = 60
export const AFTER_LANDING_MINUTES = 20

/** しおりに残す、飛行機の区間の行き方の要約（ルートの legFlights。画面にそのまま出す） */
export interface LegFlight {
  /** 区間の所要時間（分。5 分きざみに切り上げ）。出発してから行き先に着くまで（便を待つ時間も入る） */
  minutes: number
  /** 時刻表から選んだ便。目安のときは null */
  flight: {
    numbers: string[]
    airline: string
    from: { code: string; name: string }
    to: { code: string; name: string }
    /** HH:MM */
    dep: string
    arr: string
  } | null
  /** 時刻表の取得日時（ISO8601）。目安のときは null */
  fetchedAt: string | null
  /**
   * 便を決めたときの、区間を出発する時刻（0 時からの分）と、旅の何日目か。組み直しで出発が遅くなったり日が変わったりしたら、
   * この便には乗れないかもしれないので、便を外して目安にする（domain/routePlan.ts の buildPlan）
   */
  departAt?: number
  day?: number
  /**
   * 乗れる便がなく目安にしたとき、その日の最終便（区間の出発地を最も遅く出ても間に合う便。空港までの移動と手続きを足して比べる）。もっと早く空港に着くか翌日にするかを、画面で案内する
   * （かめの決定、2026-11-18、#446）。その日に便がない（直行便がない、時刻表がない）ときはない
   */
  lastFlight?: {
    airline: string
    number: string
    from: { code: string; name: string }
    to: { code: string; name: string }
    /** HH:MM。出発の時刻と、手続きを済ませるために空港に着いておく時刻 */
    dep: string
    arriveAirportBy: string
  }
}

const rad = (degrees: number) => (degrees * Math.PI) / 180
function km(a: LatLng, b: LatLng): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const pad = (value: number) => String(value).padStart(2, '0')
export const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
const ceil5 = (minutes: number) => Math.ceil(minutes / 5) * 5

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** その日（YYYY-MM-DD）に走る時刻表の曜日か。曜日の名前、平日（Weekday）、土休日（SaturdayHoliday）を見る。祝日は分からないので見ない */
export function calendarMatches(calendar: string, date: string): boolean {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const name = calendar.replace(/^odpt\.Calendar:/, '')
  if (name === DAY_NAMES[weekday]) return true
  if (name === 'Weekday') return weekday >= 1 && weekday <= 5
  if (name === 'SaturdayHoliday') return weekday === 0 || weekday === 6
  return false
}

/** 点の近くの空港（AIRPORT_RANGE_KM 以内、近い順に AIRPORT_CANDIDATES まで） */
function nearAirports(airports: readonly Airport[], at: LatLng): Airport[] {
  return airports
    .map((airport) => ({ airport, distance: km(at, airport.location) }))
    .filter(({ distance }) => distance <= AIRPORT_RANGE_KM)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, AIRPORT_CANDIDATES)
    .map(({ airport }) => airport)
}

/** 距離の式の目安（時刻表がないとき）。空港まで・空港から各 60 分、手続き、時速 600 km ＋ 15 分、降りてから */
export function estimatedFlightMinutes(from: LatLng, to: LatLng): number {
  return ceil5(60 + CHECK_IN_MINUTES + (km(from, to) / 600) * 60 + 15 + AFTER_LANDING_MINUTES + 60)
}

export interface FlightQuery {
  from: LatLng
  to: LatLng
  /** 区間を出発する時刻（0 時からの分） */
  departAt: number
  /** 区間を出発する日（YYYY-MM-DD）。時刻表の曜日を選ぶのに使う */
  date: string
  /** 地上の移動の分（旅全体の手段で見積もる。空港まで、空港から） */
  ground: (from: LatLng, to: LatLng) => number
}

/**
 * 飛行機の区間の行き方。両端の近くの空港の組み合わせごとに、その日の時刻表から、空港に着いて手続きを済ませたあとに出る最初の便を選び、
 * 行き先に最も早く着く組み合わせを返す。乗れる便がなければ（時刻表がない、直行便がない、その日の便がもうない）距離の式の目安
 */
export function planFlight(query: FlightQuery, timetable: Timetable | null): LegFlight {
  const estimate: LegFlight = { minutes: estimatedFlightMinutes(query.from, query.to), flight: null, fetchedAt: null, departAt: query.departAt }
  if (!timetable) return estimate
  const starts = nearAirports(timetable.airports, query.from)
  const ends = nearAirports(timetable.airports, query.to)
  let best: { arriveAt: number; leg: LegFlight } | null = null
  // 乗れる便がなかったときに案内する、その日の最終便。区間の出発地を最も遅く出ても間に合う便（空港までの移動と手続きを足して比べる）。
  // 出る時刻だけで選ぶと、出発地から遠い空港の便が選ばれることがある（#448 のレビューの指摘）
  let last: (FlightRun & { start: Airport; end: Airport; leaveBy: number }) | null = null
  for (const start of starts) {
    const toAirport = query.ground(query.from, start.location)
    const atAirport = query.departAt + toAirport
    const ready = atAirport + CHECK_IN_MINUTES
    for (const end of ends) {
      if (start.code === end.code) continue
      const today = timetable.routes
        .filter((route) => route.from === start.code && route.to === end.code && calendarMatches(route.calendar, query.date))
        .flatMap((route) => route.flights)
        .filter((run) => (!run.validFrom || run.validFrom <= query.date) && (!run.validTo || query.date <= run.validTo))
      for (const candidate of today) {
        const leaveBy = candidate.dep - CHECK_IN_MINUTES - toAirport
        if (!last || leaveBy > last.leaveBy) last = { ...candidate, start, end, leaveBy }
      }
      const flights = today.filter((run) => run.dep >= ready).sort((left, right) => left.dep - right.dep)
      const run = flights[0]
      if (!run) continue
      const arriveAt = run.arr + AFTER_LANDING_MINUTES + query.ground(end.location, query.to)
      if (best && best.arriveAt <= arriveAt) continue
      best = {
        arriveAt,
        leg: {
          minutes: ceil5(arriveAt - query.departAt),
          flight: {
            numbers: run.numbers,
            airline: run.airline,
            from: { code: start.code, name: start.name },
            to: { code: end.code, name: end.name },
            dep: hhmm(run.dep),
            arr: hhmm(run.arr),
          },
          fetchedAt: timetable.fetchedAt,
          departAt: query.departAt,
        },
      }
    }
  }
  if (best) return best.leg
  if (!last) return estimate
  return {
    ...estimate,
    lastFlight: {
      airline: last.airline,
      number: last.numbers[0],
      from: { code: last.start.code, name: last.start.name },
      to: { code: last.end.code, name: last.end.name },
      dep: hhmm(last.dep),
      arriveAirportBy: hhmm(Math.max(0, last.dep - CHECK_IN_MINUTES)),
    },
    fetchedAt: timetable.fetchedAt,
  }
}

/**
 * 組み直すときに、残してある便をこの区間でそのまま使えるか。同じ日で、区間の出発が便を決めたときより遅くなければ使える
 * （早くなったぶんは空港で待つ時間が延びる）。使えるなら、今の出発からの所要時間に直した行き方を返す。使えなければ null
 */
export function reuseFlight(saved: LegFlight, departAt: number, day: number): LegFlight | null {
  if (!saved.flight) {
    // 目安はそのまま使う。ただし出発の時刻か日が変わったら、前の出発で調べた最終便の案内は外す（古い案内を出さない）
    const { lastFlight, ...rest } = saved
    const same = saved.departAt === departAt && saved.day === day
    return { ...rest, ...(same && lastFlight ? { lastFlight } : {}), departAt, day }
  }
  if (saved.departAt === undefined || saved.day === undefined || saved.day !== day || departAt > saved.departAt) return null
  return { ...saved, minutes: ceil5(saved.departAt + saved.minutes - departAt), departAt, day }
}
