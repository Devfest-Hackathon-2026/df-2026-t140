import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/** しおりの行に出す天気の 4 つ。Functions（functions/src/features/shiori-weather/types.ts）と同じ */
export type Sky = 'sunny' | 'cloudy' | 'rain' | 'snow'

export interface Forecast {
  prefecture: string
  date: string
  area: string
  forecast: string
  /** 天気コードから引いた英語の概況（前の版の Functions ではない） */
  forecastEn?: string
  /** その日の天気。降水確率が 50% 以上なら雨か雪。4 つに分けられない予報と、前の版の Functions ではない */
  sky?: Sky
  /** 6 時間ごとの天気（hour は区切りの始まりの時）。短期予報の日だけ */
  skies?: { hour: number; sky: Sky }[]
}

export async function getShioriWeather(session: Session, tripId: string, prefectures: string[]): Promise<Forecast[]> {
  const fetchWeather = httpsCallable<{ tripId: string; prefectures: string[] }, { forecasts: Forecast[] }>(
    session.functions, 'shioriWeather',
  )
  return (await fetchWeather({ tripId, prefectures })).data.forecasts
}
