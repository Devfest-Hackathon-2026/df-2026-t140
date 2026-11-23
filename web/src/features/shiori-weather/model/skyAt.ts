import type { Forecast, Sky } from '../api/shioriWeather'

/** 予報の行と時刻（「HH:MM」）から、その時刻の 6 時間の区切りの天気。区切りがなければ 1 日の天気 */
export function skyAtTime(row: Pick<Forecast, 'sky' | 'skies'>, time: string): Sky | null {
  const hour = Number(/^(\d{1,2}):/.exec(time)?.[1])
  const block = Number.isFinite(hour) ? row.skies?.find((slot) => slot.hour <= hour && hour < slot.hour + 6) : undefined
  // 4 つに分けられない予報や、sky を返す前の版の Functions では、アイコンを出さない
  return block?.sky ?? row.sky ?? null
}
