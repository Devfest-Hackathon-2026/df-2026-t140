import type { WithId } from '@/shared/api'
import { translate } from '../../../shared/lib/language.ts'
import type { Route, RouteStop, RouteStyle } from './types'

/** ルート案を出すのに要る、建った場所の数。Functions の決め（functions/src/domain/route.ts）と合わせる */
export const MIN_PLACES_FOR_ROUTES = 3

/**
 * しおりのルートの ID。Functions の決め（functions/src/domain/route.ts の SHIORI_ROUTE_ID）と合わせる。
 * 建物が 1 つ建つと、Functions がこの 1 本を作り、建つたびに順番を保って足す（ルート案と投票はない）
 */
export const SHIORI_ROUTE_ID = 'shiori'

/**
 * しおりに出すルート。前の形で投票まで済んだ旅は決まったルート、それ以外はしおりのルート。
 * しおりのルートがまだない古い旅（ルート案だけがある）は、案 A を出す
 */
export function shioriRouteOf(routes: readonly WithId<Route>[], decidedRouteId: string | null): WithId<Route> | null {
  return (
    routes.find((route) => route.id === decidedRouteId) ??
    routes.find((route) => route.id === SHIORI_ROUTE_ID) ??
    routes.find((route) => route.label === 'A') ??
    null
  )
}

/** 「2h」「1h30」「45分」（しおりの小さな印） */
export function shortDurationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return translate(`${rest}分`, `${rest}m`)
  return rest === 0 ? `${hours}h` : translate(`${hours}h${String(rest).padStart(2, '0')}`, `${hours}h ${rest}m`)
}

/** 案の種類の、画面に出す名前と、ほかの案との違い */
export const STYLE_INFO: Record<RouteStyle, { title: string; summary: string }> = {
  shortest: { title: '移動が短い', summary: '移動の合計がいちばん短い順。1 か所 60 分、9 時に出発' },
  relaxed: { title: 'ゆったり', summary: '案 A の逆まわり。1 か所 120 分、10 時に出発' },
  wishes: { title: 'みんなの希望から', summary: '全員のやりたいことが、早めに 1 つずつ入る順。1 か所 90 分' },
}

/** 「40 分」「1 時間 20 分」 */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return translate(`${rest} 分`, `${rest} min`)
  return rest === 0
    ? translate(`${hours} 時間`, `${hours} hr`)
    : translate(`${hours} 時間 ${rest} 分`, `${hours} hr ${rest} min`)
}

/** スケジュールを日ごとに分ける（1 日目から順） */
export function scheduleByDay(schedule: readonly RouteStop[]): { day: number; stops: RouteStop[] }[] {
  const days: { day: number; stops: RouteStop[] }[] = []
  for (const stop of schedule) {
    const last = days[days.length - 1]
    if (last?.day === stop.day) last.stops.push(stop)
    else days.push({ day: stop.day, stops: [stop] })
  }
  return days
}

/**
 * しおりの行に、集合場所（出発地）の行を足す。1 日目にもう出発の行があれば、そのまま返す。
 * Functions は、出発地の位置が分かったときだけ出発の行を入れる（時刻と移動つき）。位置が分からない旅でも、
 * 場所の情報で回る並び（集合場所が先頭。#226）と一覧を合わせるため、時刻なしの行を先頭に足す。行がなければ足さない
 */
export function withOriginStop(schedule: readonly RouteStop[], origin: string): readonly RouteStop[] {
  const first = schedule[0]
  if (!origin || !first || schedule.some((stop) => stop.pinId === null && stop.day === first.day)) return schedule
  return [{ day: first.day, time: '', pinId: null, name: `${origin} 出発`, stayMinutes: 0, moveMinutesToNext: null }, ...schedule]
}

/** 案ごとの票の数。votedRouteIds は、メンバーそれぞれの「投票したルート」（未投票は null） */
export function countVotes(routes: readonly WithId<Route>[], votedRouteIds: readonly (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const route of routes) counts[route.id] = votedRouteIds.filter((id) => id === route.id).length
  return counts
}

/**
 * いま票がいちばん多い案。同数なら、先の案（A、B、C の順）。まだ誰も投票していなければ null。
 * 決定のしかた（Functions の features/tally-votes）と同じ決め。routes はラベルの順に並んでいること。
 */
export function leadingRoute(routes: readonly WithId<Route>[], votedRouteIds: readonly (string | null)[]): WithId<Route> | null {
  const counts = countVotes(routes, votedRouteIds)
  let leading: WithId<Route> | null = null
  for (const route of routes) {
    if (counts[route.id] > 0 && (!leading || counts[route.id] > counts[leading.id])) leading = route
  }
  return leading
}

/**
 * しおりの地図の線の点。場所を順に結び、道の形（Routes の区間の形）がある区間はそれに沿わせ、ない区間はまっすぐ結ぶ。
 * legPaths は「どこから>どこへ」（行の ID。ふつうはピンの ID）をキーにした区間の形。stops の id も行の ID。保存しないもので、しおりを開いているあいだだけ渡る
 */
export function roadLinePoints<P extends { lat: number; lng: number }>(
  stops: readonly { id: string; location: P }[],
  legPaths: readonly { key: string; points: P[] }[] = [],
): P[] {
  const pathOf = new Map(legPaths.map((leg) => [leg.key, leg.points]))
  const points: P[] = []
  stops.forEach((stop, index) => {
    if (index === 0) {
      points.push(stop.location)
      return
    }
    const path = pathOf.get(`${stops[index - 1].id}>${stop.id}`)
    // 道の形の両端は、場所の位置とずれることがあるので、場所の位置でつなぐ
    if (path && path.length >= 2) points.push(...path.slice(1, -1))
    points.push(stop.location)
  })
  return points
}
