import type { Airport, FlightRoute, FlightRun, Timetable } from '../domain/flight'
import type { FlightsPort } from '../ports/flights'

// 公共交通オープンデータセンター（ODPT）の API から、空港（odpt:Airport）と ANA・JAL のフライト時刻表（odpt:FlightSchedule）を読む。
// かめの決定（2026-11-18、#424、todo/humans/2026-11-18-odpt-flight-timetable.md）。
//
// - キーは環境変数 ODPT_CONSUMER_KEY（人が GitHub の secret に入れ、Deploy が関数の環境に渡す。リポジトリには書かない）。
//   キーがなければ、時刻表なし（距離の式の目安）
// - 時刻表は「公共交通オープンデータ基本ライセンス」。この関数の中（メモリー）にだけ持ち、Firestore にも公開リポジトリにも置かない
//   （時刻表やその写しを、第三者が再利用できる形で公開・再配布しない。基本ライセンス 第8条 4(1)）
// - 静的データは定期的に取り直す（開発者ガイドライン 2.2.2）。1 日たったら取り直す
// - 料金はかからない。呼ぶのは、しおりを作る・組み直すときに、便を探す飛行機の区間があるときだけ（domain/flightPlanner.ts の searchingFlights）と、
//   しおりで「飛行機」を選んだとき、飛行機の区間があるしおりの時刻を直したとき

const BASE = 'https://api.odpt.org/api/v4'
const OPERATORS = ['odpt.Operator:ANA', 'odpt.Operator:JAL']
/**
 * 時刻表は、航空会社 × 曜日に分けて読む。ODPT の API は 1 回で 1000 件までしか返さず、航空会社ごとに読むと
 * ANA も JAL も 1000 件で切れて、残りの路線が抜けていた（#465。2026-11-19 に本物の API で確かめた）。
 * 時刻表の曜日は曜日の名前（odpt.Calendar:Monday など）だった
 */
const CALENDARS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => `odpt.Calendar:${day}`)
/** ODPT の API が 1 回で返す件数の上限。これと同じ件数なら、切れているかもしれない */
export const ODPT_PAGE_LIMIT = 1000

/** 時刻表を読む問い合わせ（テストのために export する） */
export function scheduleQueries(): string[] {
  return OPERATORS.flatMap((operator) =>
    CALENDARS.map((calendar) => `odpt:FlightSchedule?odpt:operator=${encodeURIComponent(operator)}&odpt:calendar=${encodeURIComponent(calendar)}`),
  )
}
/** 取り直すまでの長さ（ms） */
const REFRESH_MS = 24 * 60 * 60 * 1000
/** 取得に失敗したあと、呼び直さない長さ（ms）。ODPT が落ちているときに、押すたびに待たせない */
const RETRY_AFTER_MS = 5 * 60 * 1000
/** 待つ長さ（ms）。呼び出しの打ち切り（features/change-leg-mode/handler.ts の 60 秒）より短くする */
const TIMEOUT_MS = 20_000

const codeOf = (sameAs: unknown) => (typeof sameAs === 'string' ? sameAs.replace(/^odpt\.Airport:/, '') : null)
const minutesOf = (time: unknown) => {
  if (typeof time !== 'string') return null
  const match = time.match(/^(\d{1,2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** ISO8601 の日時を、日本時間の日付（YYYY-MM-DD）にする。読めなければ null */
const dateOf = (value: unknown) => {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : null
}

/** 日本の国内の空港か（位置が日本の範囲にあるか）。国際線の空港を候補から外す */
const inJapan = (lat: number, lng: number) => lat >= 24 && lat <= 46 && lng >= 122 && lng <= 146

/**
 * odpt:Airport に位置（geo:lat、geo:long）がないときに使う、主要な国内空港の位置（空港の公表の位置をもとに、AI が手で書いた。小数 2 桁）。
 * 区間の端から 150 km 以内の空港を探すのに使うだけなので、この精度で足りる（#465）
 */
export const AIRPORT_LOCATIONS: Readonly<Record<string, { lat: number; lng: number }>> = {
  HND: { lat: 35.55, lng: 139.78 }, NRT: { lat: 35.77, lng: 140.39 }, ITM: { lat: 34.79, lng: 135.44 }, KIX: { lat: 34.43, lng: 135.23 },
  UKB: { lat: 34.63, lng: 135.22 }, NGO: { lat: 34.86, lng: 136.81 }, CTS: { lat: 42.78, lng: 141.69 }, FUK: { lat: 33.59, lng: 130.45 },
  OKA: { lat: 26.2, lng: 127.65 }, SDJ: { lat: 38.14, lng: 140.92 }, HIJ: { lat: 34.44, lng: 132.92 }, KOJ: { lat: 31.8, lng: 130.72 },
  KMJ: { lat: 32.84, lng: 130.86 }, NGS: { lat: 32.92, lng: 129.91 }, OIT: { lat: 33.48, lng: 131.74 }, KMI: { lat: 31.88, lng: 131.45 },
  MYJ: { lat: 33.83, lng: 132.7 }, TAK: { lat: 34.21, lng: 134.02 }, KCZ: { lat: 33.55, lng: 133.67 }, TKS: { lat: 34.13, lng: 134.61 },
  OKJ: { lat: 34.76, lng: 133.86 }, KMQ: { lat: 36.39, lng: 136.41 }, TOY: { lat: 36.65, lng: 137.19 }, KIJ: { lat: 37.96, lng: 139.12 },
  AOJ: { lat: 40.73, lng: 140.69 }, AXT: { lat: 39.62, lng: 140.22 }, HNA: { lat: 39.43, lng: 141.14 }, GAJ: { lat: 38.41, lng: 140.37 },
  HKD: { lat: 41.77, lng: 140.82 }, AKJ: { lat: 43.67, lng: 142.45 }, KUH: { lat: 43.04, lng: 144.19 }, MMB: { lat: 43.88, lng: 144.16 },
  OBO: { lat: 42.73, lng: 143.22 }, WKJ: { lat: 45.4, lng: 141.8 }, ISG: { lat: 24.4, lng: 124.25 }, MMY: { lat: 24.78, lng: 125.3 },
  ASJ: { lat: 28.43, lng: 129.71 }, KKJ: { lat: 33.85, lng: 131.03 }, UBJ: { lat: 33.93, lng: 131.28 }, IZO: { lat: 35.41, lng: 132.89 },
  YGJ: { lat: 35.49, lng: 133.24 }, TTJ: { lat: 35.53, lng: 134.17 }, IWJ: { lat: 34.68, lng: 131.79 }, HSG: { lat: 33.15, lng: 130.3 },
  FSZ: { lat: 34.8, lng: 138.19 }, MMJ: { lat: 36.17, lng: 137.92 }, NTQ: { lat: 37.29, lng: 136.96 }, ONJ: { lat: 40.19, lng: 140.37 },
  MSJ: { lat: 40.7, lng: 141.37 }, FKS: { lat: 37.23, lng: 140.43 }, IBR: { lat: 36.18, lng: 140.41 },
}

/** odpt:Airport の応答から、位置の分かる国内の空港を取り出す（テストのために export する）。位置がなければ AIRPORT_LOCATIONS で補う */
export function parseAirports(json: unknown): Airport[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((item): Airport[] => {
    const record = item as Record<string, unknown>
    const code = codeOf(record['owl:sameAs'])
    const known = code ? AIRPORT_LOCATIONS[code] : undefined
    const lat = typeof record['geo:lat'] === 'number' ? record['geo:lat'] : known?.lat
    const lng = typeof record['geo:long'] === 'number' ? record['geo:long'] : known?.lng
    if (!code || typeof lat !== 'number' || typeof lng !== 'number' || !inJapan(lat, lng)) return []
    const title = (record['odpt:airportTitle'] as { ja?: unknown } | undefined)?.ja ?? record['dc:title'] ?? code
    return [{ code, name: String(title), location: { lat, lng } }]
  })
}

/** odpt:FlightSchedule の応答から、空港の組み合わせごとの時刻表を取り出す（テストのために export する）。経由便は直行便でないので外す */
export function parseSchedules(json: unknown): FlightRoute[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((item): FlightRoute[] => {
    const record = item as Record<string, unknown>
    const from = codeOf(record['odpt:originAirport'])
    const to = codeOf(record['odpt:destinationAirport'])
    const calendar = typeof record['odpt:calendar'] === 'string' ? record['odpt:calendar'] : null
    const objects = record['odpt:flightScheduleObject']
    if (!from || !to || !calendar || !Array.isArray(objects)) return []
    const flights = objects.flatMap((object): FlightRun[] => {
      const run = object as Record<string, unknown>
      if (Array.isArray(run['odpt:viaAirport']) && run['odpt:viaAirport'].length > 0) return []
      const dep = minutesOf(run['odpt:originTime'])
      const arr = minutesOf(run['odpt:destinationTime'])
      const numbers = Array.isArray(run['odpt:flightNumber']) ? run['odpt:flightNumber'].filter((value): value is string => typeof value === 'string') : []
      if (dep === null || arr === null || numbers.length === 0) return []
      const depDay = Number(run['odpt:originDayDifference'] ?? 0) || 0
      const arrDay = Number(run['odpt:destinationDayDifference'] ?? 0) || 0
      // 当日に出ない便（前の日・次の日に出る便）は、しおりの 1 日の中の移動にならないので外す
      if (depDay !== 0) return []
      const airline = typeof run['odpt:airline'] === 'string' ? run['odpt:airline'].replace(/^odpt\.Operator:/, '') : ''
      // 時刻表が使える期間（日本時間の日付）。なければ期間の決めなし
      const validFrom = dateOf(run['odpt:isValidFrom'])
      const validTo = dateOf(run['odpt:isValidTo'])
      return [{ numbers, airline, dep, arr: arr + arrDay * 1440, ...(validFrom ? { validFrom } : {}), ...(validTo ? { validTo } : {}) }]
    })
    return flights.length > 0 ? [{ from, to, calendar, flights }] : []
  })
}

/**
 * 読んだ時刻表の件数の要約（ログに出す。テストのために export する）。応答の件数、位置で使えた空港の数、那覇があるか、
 * 羽田・成田 → 那覇の便の数、便の有効期間のいちばん早い・遅い日付
 */
export function timetableSummary(airportsJson: unknown, schedulesJson: readonly unknown[], airports: readonly Airport[], parsed: readonly FlightRoute[], routes: readonly FlightRoute[]) {
  const runs = parsed.flatMap((route) => route.flights)
  const dates = (pick: (run: FlightRun) => string | undefined) => runs.flatMap((run) => pick(run) ?? []).sort()
  const from = dates((run) => run.validFrom)
  const to = dates((run) => run.validTo)
  return {
    airportRecords: Array.isArray(airportsJson) ? airportsJson.length : null,
    scheduleRecords: schedulesJson.map((json) => (Array.isArray(json) ? json.length : null)),
    airports: airports.length,
    hasOKA: airports.some((airport) => airport.code === 'OKA'),
    parsedRoutes: parsed.length,
    routes: routes.length,
    tokyoToNaha: routes.filter((route) => (route.from === 'HND' || route.from === 'NRT') && route.to === 'OKA').reduce((sum, route) => sum + route.flights.length, 0),
    calendars: [...new Set(parsed.map((route) => route.calendar))].slice(0, 10),
    validFrom: from.length > 0 ? [from[0], from[from.length - 1]] : null,
    validTo: to.length > 0 ? [to[0], to[to.length - 1]] : null,
  }
}

async function get(path: string, key: string): Promise<unknown> {
  const response = await fetch(`${BASE}/${path}${path.includes('?') ? '&' : '?'}acl:consumerKey=${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`ODPT ${path.split('?')[0]}: ${response.status}`)
  return response.json()
}

let cached: { timetable: Timetable; at: number } | null = null
let loading: Promise<Timetable | null> | null = null
let failedAt = 0

async function load(key: string): Promise<Timetable | null> {
  try {
    const [airportsJson, ...schedulesJson] = await Promise.all([
      get('odpt:Airport', key),
      ...scheduleQueries().map((query) => get(query, key)),
    ])
    if (schedulesJson.some((json) => Array.isArray(json) && json.length >= ODPT_PAGE_LIMIT)) {
      console.warn(`ODPT の時刻表の応答が ${ODPT_PAGE_LIMIT} 件に達しました。切れているかもしれません`)
    }
    const airports = parseAirports(airportsJson)
    const codes = new Set(airports.map((airport) => airport.code))
    const parsed = schedulesJson.flatMap(parseSchedules)
    const routes = parsed.filter((route) => codes.has(route.from) && codes.has(route.to))
    // 本番で便が拾えない原因を調べるための件数（時刻表の中身は出さない。#465）
    console.info('ODPT の時刻表を読みました', JSON.stringify(timetableSummary(airportsJson, schedulesJson, airports, parsed, routes)))
    if (airports.length === 0 || routes.length === 0) {
      // 応答はあっても中身が空なら、失敗と同じに扱う（すぐに呼び直さない）
      console.warn('ODPT の時刻表が空でした（空港か直行便が 0 件）')
      failedAt = Date.now()
      return cached?.timetable ?? null
    }
    const timetable: Timetable = { airports, routes, fetchedAt: new Date().toISOString() }
    cached = { timetable, at: Date.now() }
    return timetable
  } catch (error) {
    console.warn('ODPT の時刻表を取れませんでした', error instanceof Error ? error.message : error)
    failedAt = Date.now()
    // 取れなければ、前に取ったものがあればそれを使う
    return cached?.timetable ?? null
  }
}

/**
 * 開発環境（Emulator）でキーがないときの見本の時刻表。画面の見た目を確かめるためだけに使う。
 * 実在の便と取り違えないよう、会社の名前と便名を「見本」にする（デモの偽装をしない）
 */
export const SAMPLE_TIMETABLE: Timetable = {
  airports: [
    { code: 'FUK', name: '福岡（見本）', location: { lat: 33.5859, lng: 130.4507 } },
    { code: 'HND', name: '羽田（見本）', location: { lat: 35.5494, lng: 139.7798 } },
    { code: 'MMJ', name: '松本（見本）', location: { lat: 36.1668, lng: 137.9227 } },
  ],
  routes: ['FUK>MMJ', 'FUK>HND', 'HND>FUK', 'MMJ>FUK'].flatMap((pair) => {
    const [from, to] = pair.split('>')
    return ['odpt.Calendar:Weekday', 'odpt.Calendar:SaturdayHoliday'].map((calendar) => ({
      from,
      to,
      calendar,
      // 福岡→松本は朝 8 時の 1 便だけにして、乗れる便がないときの案内（最終便）も見られるようにする
      flights: (pair === 'FUK>MMJ' ? [8] : [8, 11, 14, 17]).map((hour, index) => ({ numbers: [`${index + 1}便`], airline: '見本', dep: hour * 60, arr: hour * 60 + 95 })),
    }))
  }),
  fetchedAt: '2026-11-18T00:00:00.000Z',
}

export const odptFlights: FlightsPort = {
  async timetable() {
    const key = process.env.ODPT_CONSUMER_KEY?.trim()
    if (!key) return process.env.FUNCTIONS_EMULATOR === 'true' ? SAMPLE_TIMETABLE : null
    if (cached && Date.now() - cached.at < REFRESH_MS) return cached.timetable
    // 少し前に失敗していれば呼び直さず、前に取ったもの（なければ null）を使う
    if (Date.now() - failedAt < RETRY_AFTER_MS) return cached?.timetable ?? null
    loading ??= load(key).finally(() => {
      loading = null
    })
    return loading
  },
}
