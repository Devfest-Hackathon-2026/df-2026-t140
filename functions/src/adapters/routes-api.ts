import type { LatLng } from '../domain/pin'
import type { RouteLegs, RoutesApiPort } from '../ports/routes-api'
import { countApiCall } from './apiUsage'

// Google の Routes API（computeRoutes）で、しおりの区間ごとの移動時間を聞く。
// かめの決定（todo/humans/2026-11-07-shiori-routes-api.md）：本番だけで使い、開発環境では使わない。
// 本番でも、しおりを開いた人が合言葉を通しているときだけ（呼ぶかどうかは features/shiori-travel/usecase.ts が決める）。
// 規約で、Routes の時間は保存できない。画面に返すだけで、Firestore には書かない
//
// - キーは環境変数 ROUTES_API_KEY（本番は人が GitHub の secret に入れ、Deploy が関数の環境に渡す。リポジトリには書かない）
// - Emulator（FUNCTIONS_EMULATOR=true）では、キーがあっても呼ばない
// - しおりを 1 回開くたびに 1 回。出発地と場所を、経由地（intermediates）として 1 回で渡し、区間（legs）の時間だけを受け取る
// - 移動手段は車（DRIVE）。渋滞は考えない（TRAFFIC_UNAWARE。料金がいちばん安い区分）
// - 道の形（交通情報なしの encodedPolyline）も受け取り、画面の Google の地図に出すだけにする。保存しない（規約で Routes の内容は保存できない。#218）。
//   交通情報を付けないので、料金の区分は Compute Routes Essentials のまま
// - 1 日の回数は、Google Cloud の Routes API の上限（今は 30 回）で止まる。止まったら呼び出しは失敗し、目安に戻る

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'
/** 経由地の数の上限（Routes API の決まり） */
export const MAX_INTERMEDIATES = 25
/** 待つ長さ（ms）。呼び出しの打ち切り時間（features/shiori-travel/handler.ts の 30 秒）より十分短くする */
const TIMEOUT_MS = 10_000

const waypoint = (point: LatLng) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } })

/** computeRoutes に送る中身 */
export function routesRequestBody(points: readonly LatLng[]) {
  return {
    origin: waypoint(points[0]),
    destination: waypoint(points[points.length - 1]),
    intermediates: points.slice(1, -1).map(waypoint),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    languageCode: 'ja',
    units: 'METRIC',
  }
}

/** 「1234s」を秒にする。読めなければ null */
function seconds(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d+(?:\.\d+)?)s$/)
  return match ? Number(match[1]) : null
}

/**
 * computeRoutes の応答から、区間ごとの秒を取り出す（テストのために export する）。
 * 区間の数が合わなければ null（全体を目安に戻す）。道がなく routes が空なら、全区間 null
 */
export function parseLegSeconds(json: unknown, legCount: number): (number | null)[] | null {
  const routes = (json as { routes?: unknown })?.routes
  if (routes === undefined || (Array.isArray(routes) && routes.length === 0)) return Array.from({ length: legCount }, () => null)
  if (!Array.isArray(routes)) return null
  const legs = (routes[0] as { legs?: unknown })?.legs
  if (!Array.isArray(legs) || legs.length !== legCount) return null
  return legs.map((leg) => seconds((leg as { duration?: unknown })?.duration))
}

/** 1 区間の道の形の点の数の上限。多い区間は間引く（画面に返す量を抑える） */
export const MAX_PATH_POINTS = 150

/** Google の encoded polyline を緯度経度の並びにする（テストのために export する）。読めなければ null */
export function decodePolyline(encoded: string): LatLng[] | null {
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const next = (): number | null => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= encoded.length) return null
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) return null
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    const dLat = next()
    const dLng = next()
    if (dLat === null || dLng === null) return null
    lat += dLat
    lng += dLng
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points.length >= 2 ? points : null
}

/** 点が多すぎる区間を、両端を残して等間隔に間引く（テストのために export する） */
export function thinPath(points: readonly LatLng[], max: number = MAX_PATH_POINTS): LatLng[] {
  if (points.length <= max) return [...points]
  const step = (points.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)])
}

/**
 * computeRoutes の応答から、区間ごとの秒と道の形を取り出す（テストのために export する）。
 * 区間の数が合わなければ null。道がなく routes が空なら、全区間 null
 */
export function parseLegs(json: unknown, legCount: number): RouteLegs | null {
  const seconds = parseLegSeconds(json, legCount)
  if (!seconds) return null
  const legs = ((json as { routes?: { legs?: unknown }[] })?.routes?.[0]?.legs ?? []) as { polyline?: { encodedPolyline?: unknown } }[]
  const paths = Array.from({ length: legCount }, (_, i) => {
    const encoded = Array.isArray(legs) ? legs[i]?.polyline?.encodedPolyline : undefined
    const decoded = typeof encoded === 'string' ? decodePolyline(encoded) : null
    return decoded ? thinPath(decoded) : null
  })
  return { seconds, paths }
}

/** 開発環境（Emulator）か。Routes を呼ばず、見本の線を返す */
export function routesSampleMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === 'true'
}

/** Emulator ではなく、キーがあるか */
export function routesApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR !== 'true' && (env.ROUTES_API_KEY ?? '').trim().length > 0
}

export const routesApi: RoutesApiPort = {
  enabled: () => routesApiEnabled(),
  sampleMode: () => routesSampleMode(),
  async legs(points) {
    const key = process.env.ROUTES_API_KEY?.trim()
    if (!routesApiEnabled() || !key || points.length < 2) return null
    if (points.length - 2 > MAX_INTERMEDIATES) return null
    try {
      await countApiCall('routes')
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          // 区間の時間と道の形だけを受け取る（距離や交通情報は受け取らない。料金の区分は Essentials のまま）
          'X-Goog-FieldMask': 'routes.legs.duration,routes.legs.polyline.encodedPolyline',
        },
        body: JSON.stringify(routesRequestBody(points)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`Routes API が失敗しました（${response.status}）。直線距離の目安に戻します`)
        return null
      }
      return parseLegs(await response.json(), points.length - 1)
    } catch (error) {
      console.warn(`Routes API を呼べませんでした（${error instanceof Error ? error.name : 'unknown'}）。直線距離の目安に戻します`)
      return null
    }
  },
}
