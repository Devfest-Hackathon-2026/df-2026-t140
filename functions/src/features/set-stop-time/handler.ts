import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { STOP_ID, stopOfTimeKey } from '../../domain/visit'
import { isDayMinutes } from './logic'
import { setStopTime as set } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const MARK = /^(@meet|@origin)$/

/** しおりの時刻（集合時間、出発時間、場所に着く時刻と出る時刻）を人が直す。ルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ */
export const setStopTime = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId, key, minutes, force } = (request.data ?? {}) as Record<string, unknown>
  const valid =
    typeof tripId === 'string' && ID.test(tripId) && typeof routeId === 'string' && ID.test(routeId)
    && typeof key === 'string' && (MARK.test(key) || STOP_ID.test(stopOfTimeKey(key))) && isDayMinutes(minutes)
    && (force === undefined || typeof force === 'boolean')
  if (!valid) throw new HttpsError('invalid-argument', '旅としおりと、直す時刻を指定してください')
  const result = await set({ db: firestore(), flights: odptFlights }, { tripId, routeId, key, minutes, uid: request.auth.uid, force: force === true })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているあいだは、発案者だけが時刻を直せます')
  if (result.status === 'fixed') throw new HttpsError('failed-precondition', 'イベントの時刻は開催の時刻から変えられません')
  return result
})
