import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { confirmShiori as confirmShioriUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// 旅程を確定する（しおりの一番下の「この旅程で確定する！」）・取り消す（しおりビューの「確定を取り消す」）。usecase.ts。
// 確定の印を書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。発案者だけ。外の API は呼ばない。
// 前は確定だけを受け、取り消せない形だった（#393）。2026-11-20 から 2026-11-21 までは断るだけの関数だった（#472）
export const confirmShiori = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, confirm } = (request.data ?? {}) as Record<string, unknown>
  if (typeof tripId !== 'string' || !ID.test(tripId)) throw new HttpsError('invalid-argument', '旅を指定してください')
  // 前の画面は confirm を送らない（確定だけだった）。送らなければ確定として受ける
  const want = confirm === undefined ? true : confirm
  if (typeof want !== 'boolean') throw new HttpsError('invalid-argument', '確定するか取り消すかを指定してください')
  const result = await confirmShioriUsecase({ db: firestore() }, { tripId, uid: request.auth.uid, confirm: want })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', '旅が見つかりません')
  if (result.status === 'not-owner') throw new HttpsError('permission-denied', '旅程を確定・取り消しできるのは、発案者だけです')
  if (result.status === 'empty') throw new HttpsError('failed-precondition', 'しおりにまだ場所がありません')
  if (result.status === 'building') throw new HttpsError('failed-precondition', '建物ができて、しおりに入ってから確定できます')
  if (result.status === 'lodging') throw new HttpsError('failed-precondition', '宿が決まっていない夜があります。宿を建てるか、過ごし方を書くと、確定できます')
  return result
})
