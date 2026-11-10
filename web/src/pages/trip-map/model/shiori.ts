// しおり（S11〜S13）の小さな決め。

/** 日程の短い表示：「11/21–22」「11/30–12/1」。終了日なし（日帰り）は「11/21」 */
export function dateRangeLabel(startDate: string, endDate: string | null): string {
  const [, startMonth, startDay] = startDate.split('-').map(Number)
  const start = `${startMonth}/${startDay}`
  if (!endDate || endDate === startDate) return start
  const [, endMonth, endDay] = endDate.split('-').map(Number)
  return endMonth === startMonth ? `${start}–${endDay}` : `${start}–${endMonth}/${endDay}`
}

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

/**
 * 場所の情報（S12）に出す断り書き。建物が用意した部品の模型のときだけ（本物の Gemini が作っていないと分かるように）。
 * 場所を誰が出したか・Google マップで確かめたかは出さない（ヨウキンの要望、2026-11-08、#208。場所カード S05 では今までどおり出す）。
 * なければ undefined
 */
export function placeNote(modelSource: string | undefined): string | undefined {
  return modelSource && modelSource !== 'argon' ? '建物は用意した部品の模型です' : undefined
}

/**
 * 場所の情報（S12）としおりの再生で、建った場所の写真と口コミを何で聞くか。Places で確かめた place_id。
 * なければ 'by-name'（Functions が名前と地域で探す。用意した部品の模型で建った場所は place_id がない。#279）。
 * 手元（Emulator）では Functions が Places を呼ばずに、開発用の見本を返す（#215）
 */
export function placeReviewsAsk(placeId: string | null): string {
  return placeId ?? 'by-name'
}
