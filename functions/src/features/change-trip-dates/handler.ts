import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { normalizeDates } from './logic'
import { changeTripDates as change } from './usecase'

/** 発案者が、旅の設定から日程を変える。便を探す飛行機の区間があれば時刻表（ODPT）を読むので、その待ち（最大 20 秒）が収まる長さにする */
export const changeTripDates = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, startDate, endDate } = request.data ?? {}
  const dates = normalizeDates(startDate, endDate)
  if (typeof tripId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || !dates) {
    throw new HttpsError('invalid-argument', '旅と日程を指定してください')
  }
  const result = await change({ db: firestore(), flights: odptFlights }, { tripId, uid: request.auth.uid, ...dates })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-owner') throw new HttpsError('permission-denied', '日程を変えられるのは発案者だけです')
  if (result.status === 'not-found') throw new HttpsError('not-found', '旅が見つかりません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  return result
})
