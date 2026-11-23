/**
 * Google マップで、出発地からしおりの順に回る道順を開く URL（Maps URLs。キーは要らず、Maps の内容も取ってこない）。
 * 場所は名前で渡す。途中の場所は 9 か所まで（Maps URLs の決まり）
 */
export function directionsUrl(origin: string, places: readonly string[]): string {
  const params = new URLSearchParams({ api: '1', origin, destination: places[places.length - 1] ?? origin })
  const waypoints = places.slice(0, -1).slice(0, 9)
  if (waypoints.length > 0) params.set('waypoints', waypoints.join('|'))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
