import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { placesApi } from '../../adapters/places-api'
import { originName } from './logic'
import { changeOrigin as change, resolveOrigin as resolve } from './usecase'

function ports() { const db = firestore(); return { db, aiGate: aiGate(db), placesApi, flights: odptFlights } }

export const resolveOrigin = onCall({ timeoutSeconds: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const name = originName(request.data?.name)
  if (!name) throw new HttpsError('invalid-argument', '出発地を40文字以内で入れてください')
  return resolve(ports(), name, request.auth.uid)
})

// 集合場所からの区間が飛行機になると時刻表（ODPT）を読むので、Places とその待ち（最大 20 秒）が収まる長さにする
export const changeOrigin = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, expectedOrigin } = request.data ?? {}
  const name = originName(request.data?.name)
  if (!name || typeof tripId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !originName(expectedOrigin)) {
    throw new HttpsError('invalid-argument', '旅と出発地を指定してください')
  }
  const result = await change(ports(), { tripId, uid: request.auth.uid, name, expectedOrigin })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  return result
})
