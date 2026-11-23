import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { isTravelMode } from '../../domain/travelMode'
import { changeTravelMode as change } from './usecase'

/** しおりで、旅の移動手段（車、電車・バス、飛行機）を選び直す。便を探す飛行機の区間があれば時刻表（ODPT）を読むので、その待ち（最大 20 秒）が収まる長さにする */
export const changeTravelMode = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, mode } = request.data ?? {}
  if (typeof tripId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !isTravelMode(mode)) {
    throw new HttpsError('invalid-argument', '旅と移動手段を指定してください')
  }
  const result = await change({ db: firestore(), flights: odptFlights }, { tripId, uid: request.auth.uid, mode })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  return result
})
