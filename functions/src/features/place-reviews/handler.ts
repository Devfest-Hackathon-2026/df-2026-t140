import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { placesApi } from '../../adapters/places-api'
import { placeReviews as placeReviewsUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// 場所の情報（S12）を開いたときに、Google マップの口コミを返す。保存はしない（規約のため。usecase.ts）。
// 人が口コミを出すと決めるまでは、PLACES_REVIEWS が on でないので { status: 'unavailable' } を返す。Places は 1 回最大 10 秒
export const placeReviews = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, pinId } = (request.data ?? {}) as { tripId?: unknown; pinId?: unknown }
  if (typeof tripId !== 'string' || typeof pinId !== 'string' || !ID.test(tripId) || !ID.test(pinId)) {
    throw new HttpsError('invalid-argument', '旅と場所を指定してください')
  }
  const db = firestore()
  const result = await placeReviewsUsecase({ db, aiGate: aiGate(db), placesApi }, { tripId, pinId, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', '場所が見つかりません')
  return result
})
