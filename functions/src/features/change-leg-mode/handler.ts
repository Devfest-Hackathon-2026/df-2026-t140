import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { isLegMode } from '../../domain/travelMode'
import { STOP_ID } from '../../domain/visit'
import { changeLegMode as change } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/
// 区間の両端は行の ID（ふつうはピンの ID。domain/visit.ts）。出発は、出発地の @origin もある
const ORIGIN = '@origin'

/** しおりの移動の行で、区間ごとの手段（電車・バス、車、徒歩、飛行機）を選び直す。mode が null なら旅全体の手段に戻す */
export const changeLegMode = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId, from, to, mode } = (request.data ?? {}) as Record<string, unknown>
  const valid =
    typeof tripId === 'string' && ID.test(tripId) && typeof routeId === 'string' && ID.test(routeId)
    && typeof from === 'string' && (from === ORIGIN || STOP_ID.test(from)) && typeof to === 'string' && STOP_ID.test(to)
    && (mode === null || isLegMode(mode))
  if (!valid) throw new HttpsError('invalid-argument', '旅としおりと、区間と移動手段を指定してください')
  const result = await change({ db: firestore(), flights: odptFlights }, { tripId, routeId, from, to, mode, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  return result
})
