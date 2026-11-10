import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { routesApi } from '../../adapters/routes-api'
import { shioriTravel as shioriTravelUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// しおりを開いたときに、Routes API（車）の移動時間で計算し直したスケジュールを返す。保存はしない（規約のため。usecase.ts）。
// 本番で、合言葉を通した人だけ。そうでなければ { status: 'estimate' } を返し、画面は保存してある目安を出す。
// Routes は 1 回最大 10 秒（adapters/routes-api.ts）
export const shioriTravel = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId } = (request.data ?? {}) as { tripId?: unknown; routeId?: unknown }
  if (typeof tripId !== 'string' || typeof routeId !== 'string' || !ID.test(tripId) || !ID.test(routeId)) {
    throw new HttpsError('invalid-argument', '旅としおりを指定してください')
  }
  const db = firestore()
  const result = await shioriTravelUsecase({ db, aiGate: aiGate(db), routesApi }, { tripId, routeId, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', 'しおりが見つかりません')
  return result
})
