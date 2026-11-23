import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { jmaForecast } from '../../adapters/jmaForecast'
import { firestore } from '../../adapters/firestore'
import { canonicalPrefectures, MAX_PREFECTURES } from './logic'
import { shioriWeather as shioriWeatherUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// しおりの日ごとの天気。旅のメンバーだけが、府県の名前（正式な名前、最大 8 県）で聞ける。
// 気象庁の府県天気予報を使う（出典はしおりに出す）。保存はしない。
export const shioriWeather = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, prefectures } = (request.data ?? {}) as { tripId?: unknown; prefectures?: unknown }
  if (typeof tripId !== 'string' || !ID.test(tripId)) throw new HttpsError('invalid-argument', '旅を指定してください')
  const picked = canonicalPrefectures(prefectures)
  if (!picked.ok) {
    throw new HttpsError(
      'invalid-argument',
      picked.reason === 'too-many' ? `府県は ${MAX_PREFECTURES} 県までです` : '府県の名前を確かめてください',
    )
  }
  const db = firestore()
  const result = await shioriWeatherUsecase(
    { db, jma: jmaForecast },
    { tripId, uid: request.auth.uid, prefectures: picked.names, now: Date.now() },
  )
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', '旅が見つかりません')
  return { forecasts: result.forecasts }
})
