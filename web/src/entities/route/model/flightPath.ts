// 飛行機の区間を、地図の上で空港を経由する線にする決め（純粋）。
// 区間の出発地 → 乗る空港 → 降りる空港 → 行き先 の順に結ぶ。空港の前後は地上の移動、空港どうしは空の移動。
// 空港は、しおりに残した便（Route.legFlights）の空港。便が決まっていない目安の区間は、最終便の空港か、両端に最も近い空港にする。

// ブラウザなしのテスト（scripts/web.test.mjs）で読めるよう、型と言語の切り替えのほかは import しない（距離の式は legs.ts の distanceKm と同じ）
import { appLanguage, translate } from '../../../shared/lib/language.ts'
import type { LegFlight } from './types'

interface Point {
  lat: number
  lng: number
}

/**
 * 主要な国内空港の位置（IATA の 3 文字から引く）。Functions 側の同じ表は functions/src/adapters/odpt.ts の AIRPORT_LOCATIONS。
 * 片方を変えたら、もう片方も合わせる。地図に空港を経由する線を引くためだけに使うので、小数 2 桁で足りる
 */
export const AIRPORT_LOCATIONS: Readonly<Record<string, Point>> = {
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

/** 便が決まっていない区間で、空港を探す範囲（区間の端からの直線 km）。Functions 側の AIRPORT_RANGE_KM（domain/flight.ts）と同じ */
const AIRPORT_RANGE_KM = 150

function distanceKm(from: Point, to: Point): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const h =
    Math.sin(radians(to.lat - from.lat) / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(radians(to.lng - from.lng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function nearestAirport(point: Point): string | null {
  let best: { code: string; km: number } | null = null
  for (const [code, location] of Object.entries(AIRPORT_LOCATIONS)) {
    const km = distanceKm(point, location)
    if (km <= AIRPORT_RANGE_KM && (!best || km < best.km)) best = { code, km }
  }
  return best?.code ?? null
}

/**
 * 空港の、しおりと地図に出す名前（AIRPORT_LOCATIONS と同じ 3 文字から引く）。ふだん呼ばれている名前にする。
 * 表にない空港は、便の空港の名前（時刻表の名前）に「空港」を付けて出す
 */
export const AIRPORT_NAMES: Readonly<Record<string, string>> = {
  HND: '羽田空港', NRT: '成田空港', ITM: '伊丹空港', KIX: '関西空港', UKB: '神戸空港', NGO: '中部国際空港', CTS: '新千歳空港',
  FUK: '福岡空港', OKA: '那覇空港', SDJ: '仙台空港', HIJ: '広島空港', KOJ: '鹿児島空港', KMJ: '熊本空港', NGS: '長崎空港',
  OIT: '大分空港', KMI: '宮崎空港', MYJ: '松山空港', TAK: '高松空港', KCZ: '高知龍馬空港', TKS: '徳島空港', OKJ: '岡山空港',
  KMQ: '小松空港', TOY: '富山空港', KIJ: '新潟空港', AOJ: '青森空港', AXT: '秋田空港', HNA: 'いわて花巻空港', GAJ: '山形空港',
  HKD: '函館空港', AKJ: '旭川空港', KUH: '釧路空港', MMB: '女満別空港', OBO: '帯広空港', WKJ: '稚内空港', ISG: '石垣空港',
  MMY: '宮古空港', ASJ: '奄美空港', KKJ: '北九州空港', UBJ: '山口宇部空港', IZO: '出雲空港', YGJ: '米子空港', TTJ: '鳥取空港',
  IWJ: '萩・石見空港', HSG: '佐賀空港', FSZ: '富士山静岡空港', MMJ: '信州まつもと空港', NTQ: '能登空港', ONJ: '大館能代空港',
  MSJ: '三沢空港', FKS: '福島空港', IBR: '茨城空港',
}

/** AIRPORT_NAMES の英語の名前（同じ 3 文字から引く） */
export const AIRPORT_NAMES_EN: Readonly<Record<string, string>> = {
  HND: 'Haneda Airport', NRT: 'Narita Airport', ITM: 'Itami Airport', KIX: 'Kansai Airport', UKB: 'Kobe Airport', NGO: 'Chubu Centrair Airport', CTS: 'New Chitose Airport',
  FUK: 'Fukuoka Airport', OKA: 'Naha Airport', SDJ: 'Sendai Airport', HIJ: 'Hiroshima Airport', KOJ: 'Kagoshima Airport', KMJ: 'Kumamoto Airport', NGS: 'Nagasaki Airport',
  OIT: 'Oita Airport', KMI: 'Miyazaki Airport', MYJ: 'Matsuyama Airport', TAK: 'Takamatsu Airport', KCZ: 'Kochi Ryoma Airport', TKS: 'Tokushima Airport', OKJ: 'Okayama Airport',
  KMQ: 'Komatsu Airport', TOY: 'Toyama Airport', KIJ: 'Niigata Airport', AOJ: 'Aomori Airport', AXT: 'Akita Airport', HNA: 'Iwate Hanamaki Airport', GAJ: 'Yamagata Airport',
  HKD: 'Hakodate Airport', AKJ: 'Asahikawa Airport', KUH: 'Kushiro Airport', MMB: 'Memanbetsu Airport', OBO: 'Obihiro Airport', WKJ: 'Wakkanai Airport', ISG: 'Ishigaki Airport',
  MMY: 'Miyako Airport', ASJ: 'Amami Airport', KKJ: 'Kitakyushu Airport', UBJ: 'Yamaguchi Ube Airport', IZO: 'Izumo Airport', YGJ: 'Yonago Airport', TTJ: 'Tottori Airport',
  IWJ: 'Hagi-Iwami Airport', HSG: 'Saga Airport', FSZ: 'Mt. Fuji Shizuoka Airport', MMJ: 'Shinshu-Matsumoto Airport', NTQ: 'Noto Airport', ONJ: 'Odate-Noshiro Airport',
  MSJ: 'Misawa Airport', FKS: 'Fukushima Airport', IBR: 'Ibaraki Airport',
}

/**
 * 飛行機の区間で乗り降りする空港。しおりでは、建物と同じ「場所」として行と地図の印に出し、再生でも止まる。
 * time は、便が決まっていれば、乗る空港は出発の時刻、降りる空港は到着の時刻（HH:MM）。目安の区間は null
 */
export interface AirportStop {
  code: string
  name: string
  location: Point
  time: string | null
}

function airportName(code: string, flightName: string | undefined): string {
  const known = AIRPORT_NAMES[code]
  if (known) return translate(known, AIRPORT_NAMES_EN[code] ?? known)
  // 表にない空港は、時刻表の名前が日本語しかないので、英語のときは 3 文字で出す
  if (appLanguage === 'en') return code
  const name = flightName?.replace(/（見本）$/, '').trim()
  if (!name) return code
  return name.endsWith('空港') ? name : `${name}空港`
}

/**
 * 飛行機の区間で乗る空港と降りる空港。便があればその便の空港、目安なら最終便の空港、どちらもなければ両端に最も近い空港。
 * 空港の位置が分からない、乗る空港と降りる空港が同じ、のときは null（区間の両端をまっすぐ結ぶ）
 */
export function legAirportStops(flight: LegFlight | undefined, from: Point, to: Point): { from: AirportStop; to: AirportStop } | null {
  const run = flight?.flight ?? null
  const codes = run ?? flight?.lastFlight
  const fromCode = codes?.from.code ?? nearestAirport(from)
  const toCode = codes?.to.code ?? nearestAirport(to)
  if (!fromCode || !toCode || fromCode === toCode) return null
  const departure = AIRPORT_LOCATIONS[fromCode]
  const arrival = AIRPORT_LOCATIONS[toCode]
  if (!departure || !arrival) return null
  return {
    from: { code: fromCode, name: airportName(fromCode, codes?.from.name), location: departure, time: run?.dep ?? null },
    to: { code: toCode, name: airportName(toCode, codes?.to.name), location: arrival, time: run?.arr ?? null },
  }
}

/** 飛行機の区間で乗る空港と降りる空港の位置（legAirportStops の位置だけ） */
export function legAirports(flight: LegFlight | undefined, from: Point, to: Point): { from: Point; to: Point } | null {
  const stops = legAirportStops(flight, from, to)
  return stops ? { from: stops.from.location, to: stops.to.location } : null
}

/**
 * 飛行機の区間の線。出発地 → 乗る空港 → 降りる空港 → 行き先。air は、空の移動が points のどこからどこまでか（点の番号）。
 * airports は乗り降りする空港（再生で止まる、地図に印を出す）。空港が分からなければ null（呼ぶ側は、区間の両端をまっすぐ結ぶ）
 */
export function flightLegPath(
  flight: LegFlight | undefined,
  from: Point,
  to: Point,
): { points: Point[]; air: [number, number]; airports: { from: AirportStop; to: AirportStop } } | null {
  const airports = legAirportStops(flight, from, to)
  if (!airports) return null
  return { points: [from, airports.from.location, airports.to.location, to], air: [1, 2], airports }
}
