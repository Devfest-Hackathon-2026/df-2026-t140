import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { dismissFiller as dismiss } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/** しおりの空いた時間への提案を「無視」する（#520）。ピンを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。外の API は呼ばない */
export const dismissFiller = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, pinId } = (request.data ?? {}) as Record<string, unknown>
  if (typeof tripId !== 'string' || typeof pinId !== 'string' || !ID.test(tripId) || !ID.test(pinId)) {
    throw new HttpsError('invalid-argument', '旅と提案を指定してください')
  }
  const result = await dismiss({ db: firestore() }, { tripId, pinId, uid: request.auth.uid })
  if (result === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result === 'not-found') throw new HttpsError('not-found', 'この提案が見つかりません')
  return { status: result }
})
