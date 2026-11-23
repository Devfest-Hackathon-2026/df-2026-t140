import type { Forecast } from '../api/shioriWeather'

// 決まったしおりの天気予報を、この端末に覚えておく形と、取り直すかどうかの決め。
// 開いて初めては取り、そのあとは覚えた予報を使う。覚えてから 1 日たったら取り直す（Takana の依頼、2026-11-22）。
// 型のほかは何も読み込まない（テストからそのまま呼べるように）

/** 覚えた予報を使ってよい長さ（ms）。これより古ければ取り直す */
export const WEATHER_CACHE_MS = 24 * 60 * 60 * 1000

export interface WeatherCache {
  /** 取った時刻（ms） */
  fetchedAt: number
  forecasts: Forecast[]
}

/** 覚えておく場所の名前。旅と、予報を引く府県の組ごとに分ける（府県が変われば取り直す） */
export function weatherCacheKey(tripId: string, areaKey: string): string {
  return `shioriWeather:${tripId}:${areaKey}`
}

/** 覚えた文字列を読む。形が違う、壊れているときは null（取り直す） */
export function parseWeatherCache(text: string | null): WeatherCache | null {
  if (!text) return null
  try {
    const value = JSON.parse(text) as Partial<WeatherCache>
    if (typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || !Array.isArray(value.forecasts)) return null
    return { fetchedAt: value.fetchedAt, forecasts: value.forecasts }
  } catch {
    return null
  }
}

/** 覚えた予報がまだ使えるか（取ってから 1 日たっていない。時計が戻って未来の時刻になっているものは使わない） */
export function isWeatherCacheFresh(cache: WeatherCache | null, now: number): cache is WeatherCache {
  return cache !== null && cache.fetchedAt <= now && now - cache.fetchedAt < WEATHER_CACHE_MS
}

/** 覚えた予報が古くなるまでの時間（ms）。もう古ければ 0 */
export function weatherCacheRemaining(cache: WeatherCache, now: number): number {
  return Math.max(0, cache.fetchedAt + WEATHER_CACHE_MS - now)
}

// 過ぎた日の予報は、気象庁からもう取れない。決まったしおりで過ぎた日の天気も出し続けるよう、
// 取った予報を旅ごとに積んで覚えておく（同じ府県・日・予報区は新しいもので置き換える。Takana の依頼、2026-11-23）

/** 旅ごとに積んだ予報を覚えておく場所の名前 */
export function weatherArchiveKey(tripId: string): string {
  return `shioriWeatherArchive:${tripId}`
}

/** 府県の組ごとに覚えた予報（weatherCacheKey）の名前の頭。積む前の版で覚えた予報を拾い直すのに使う */
export function weatherCachePrefix(tripId: string): string {
  return `shioriWeather:${tripId}:`
}

const rowKey = (row: Pick<Forecast, 'prefecture' | 'date' | 'area'>) => `${row.prefecture}\n${row.date}\n${row.area}`

/** 前の予報に新しい予報を重ねる。同じ府県・日・予報区は新しいほう。並びは前の予報の順のまま、新しい行は後ろに足す */
export function mergeForecasts(older: readonly Forecast[], newer: readonly Forecast[]): Forecast[] {
  const rows = new Map(older.map((row) => [rowKey(row), row]))
  for (const row of newer) rows.set(rowKey(row), row)
  return [...rows.values()]
}

/** 積んだ予報を読む。形の違う行は捨てる。壊れていれば空 */
export function parseForecastArchive(text: string | null): Forecast[] {
  if (!text) return []
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value)) return []
    return value.filter(
      (row): row is Forecast =>
        typeof row === 'object' && row !== null && typeof row.prefecture === 'string' && typeof row.date === 'string' && typeof row.area === 'string',
    )
  } catch {
    return []
  }
}
