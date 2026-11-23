import { useEffect, useMemo, useState } from 'react'
import type { Pin } from '@/entities/pin'
import type { RouteStop } from '@/entities/route'
import { ALL_PREFECTURES } from '@/entities/trip'
import { type Session, type WithId, useSession } from '@/shared/api'
import { addDays, recall, recallAll, remember } from '@/shared/lib'
import { getShioriWeather, type Forecast, type Sky } from '../api/shioriWeather'
import { skyAtTime } from './skyAt'
import {
  isWeatherCacheFresh,
  mergeForecasts,
  parseForecastArchive,
  parseWeatherCache,
  type WeatherCache,
  weatherArchiveKey,
  weatherCacheKey,
  weatherCachePrefix,
  weatherCacheRemaining,
} from './weatherCache'

interface WeatherDay {
  date: string
  prefectures: Set<string>
}

/** ピンの住所（「京都府京都市…」）の書き出しから、都道府県の正式な名前。分からなければ undefined */
function prefectureOf(pin: Pin | undefined): string | undefined {
  const area = pin?.area?.trim()
  return area ? ALL_PREFECTURES.find((name) => area.startsWith(name)) : undefined
}

function daysWithDestinations(startDate: string, stops: readonly RouteStop[], pins: readonly WithId<Pin>[]): WeatherDay[] {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', dateStyle: 'short' }).format(new Date())
  const lastDay = addDays(today, 7)
  const pinsById = new Map(pins.map((pin) => [pin.id, pin]))
  const days = new Map<string, Set<string>>()
  for (const stop of stops) {
    const prefecture = prefectureOf(stop.pinId ? pinsById.get(stop.pinId) : undefined)
    if (!prefecture) continue
    const date = addDays(startDate, stop.day - 1)
    if (date < today || date > lastDay) continue
    const prefectures = days.get(date) ?? new Set<string>()
    prefectures.add(prefecture)
    days.set(date, prefectures)
  }
  return [...days].map(([date, prefectures]) => ({ date, prefectures }))
}

/**
 * 予報を出し続ける。覚えた予報が 1 日たっていなければそれを出し、なければ最新を取る。覚えた予報が古くなるころに取り直す。
 * 全部取れたときだけ覚える（取れなかった府県を 1 日空のままにしないため）。取れなかったときは、古くても覚えた予報があればそれを出す。
 * 止める関数を返す
 */
function watchWeather(session: Session, tripId: string, areaKey: string, onForecasts: (forecasts: Forecast[]) => void): () => void {
  const storageKey = weatherCacheKey(tripId, areaKey)
  const run = { stopped: false, timer: undefined as number | undefined }
  const show = (cache: WeatherCache) => {
    onForecasts(cache.forecasts)
    run.timer = window.setTimeout(refresh, weatherCacheRemaining(cache, Date.now()))
  }
  function refresh() {
    const areas = areaKey.split(',')
    const requests: Promise<Forecast[] | null>[] = []
    for (let i = 0; i < areas.length; i += 8) {
      requests.push(getShioriWeather(session, tripId, areas.slice(i, i + 8)).catch(() => null))
    }
    void Promise.all(requests).then((batches) => {
      if (run.stopped) return
      const forecasts = batches.flatMap((batch) => batch ?? [])
      // 関数は府県ごとの失敗を飛ばして返すので、頼んだ府県の予報がすべてそろったときだけ「全部取れた」とする
      const got = new Set(forecasts.map((row) => row.prefecture))
      if (batches.every((batch) => batch !== null) && areas.every((area) => got.has(area))) {
        const cache = { fetchedAt: Date.now(), forecasts }
        remember(storageKey, JSON.stringify(cache))
        show(cache)
        return
      }
      const stale = parseWeatherCache(recall(storageKey))
      onForecasts(forecasts.length > 0 || !stale ? forecasts : stale.forecasts)
    })
  }
  const cached = parseWeatherCache(recall(storageKey))
  if (isWeatherCacheFresh(cached, Date.now())) show(cached)
  else refresh()
  return () => {
    run.stopped = true
    window.clearTimeout(run.timer)
  }
}

/**
 * 旅ごとに積んだ予報を読む。積む前の版で府県の組ごとに覚えた予報も拾い、積んだ予報を優先して重ねる
 * （過ぎた日の予報は気象庁から取れないので、端末に残っているものを使い続ける）
 */
function loadArchive(tripId: string): Forecast[] {
  const archived = parseForecastArchive(recall(weatherArchiveKey(tripId)))
  const older = recallAll(weatherCachePrefix(tripId)).flatMap((text) => parseWeatherCache(text)?.forecasts ?? [])
  return mergeForecasts(older, archived)
}

/** 取った予報を、積んだ予報に重ねて覚え、重ねたものを返す。旅の日付の外の行は積まない（端末に溜めすぎない） */
function archiveForecasts(tripId: string, startDate: string, endDate: string, fresh: readonly Forecast[]): Forecast[] {
  const merged = mergeForecasts(loadArchive(tripId), fresh).filter((row) => startDate <= row.date && row.date <= endDate)
  remember(weatherArchiveKey(tripId), JSON.stringify(merged))
  return merged
}

export interface ShioriWeatherData {
  /**
   * 行のアイコンに出す天気。ピンの府県のその日の予報から引き、6 時間ごとの天気があれば時刻（「HH:MM」）の区切りのものを使う。
   * 府県に予報区がいくつもあるときは、気象庁の並びで最初の予報区（多くは府県庁のある区域）を使う。
   * 過ぎた日は、その日の前に最後に取った予報を出す。予報がなければ null
   */
  skyAt: (pinId: string | null | undefined, date: string, time: string) => Sky | null
}

export function useShioriWeather(
  tripId: string,
  startDate: string,
  endDate: string | null,
  stops: readonly RouteStop[],
  pins: readonly WithId<Pin>[],
): ShioriWeatherData {
  const session = useSession()
  const days = daysWithDestinations(startDate, stops, pins)
  const areaKey = [...new Set(days.flatMap(({ prefectures }) => [...prefectures]))].sort().join(',')
  const [result, setResult] = useState<{ key: string; forecasts: Forecast[] }>()
  const key = `${tripId}:${startDate}:${endDate ?? startDate}:${areaKey}`
  // 取り終えるまで（と、これから先の日がなく取らないとき）は、この端末に積んだ予報を出す
  const archived = useMemo(() => (tripId ? loadArchive(tripId) : []), [tripId])

  useEffect(
    () =>
      areaKey
        ? watchWeather(session, tripId, areaKey, (forecasts) => setResult({ key, forecasts: archiveForecasts(tripId, startDate, endDate ?? startDate, forecasts) }))
        : undefined,
    [areaKey, endDate, key, session, startDate, tripId],
  )

  const forecasts = result?.key === key ? result.forecasts : archived
  const pinsById = new Map(pins.map((pin) => [pin.id, pin]))
  return {
    skyAt: (pinId, date, time) => {
      const prefecture = prefectureOf(pinId ? pinsById.get(pinId) : undefined)
      const row = prefecture ? forecasts.find((forecast) => forecast.date === date && forecast.prefecture === prefecture) : undefined
      return row ? skyAtTime(row, time) : null
    },
  }
}
