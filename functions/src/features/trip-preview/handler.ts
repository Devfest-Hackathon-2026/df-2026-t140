import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { previewTrip as previewTripUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// 招待された旅の名前を返す。招待の画面（参加する前）が、見出しに旅の名前を出すために呼ぶ。
// 名前だけを返し、出発地や日程は返さない。Gemini も Maps も呼ばない。
export const previewTrip = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId } = (request.data ?? {}) as { tripId?: unknown }
  if (typeof tripId !== 'string' || !ID.test(tripId)) throw new HttpsError('invalid-argument', '旅を指定してください')

  const result = await previewTripUsecase({ db: firestore() }, { tripId })
  if (result === 'not-found') throw new HttpsError('not-found', 'この旅が見つかりません')
  return { title: result.title }
})
