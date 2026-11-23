import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { restorePlace as restorePlaceUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// 場所カードの「しおりに戻す」で、しおりから外した場所をしおりに戻す（usecase.ts）。
// ルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。旅のメンバーだけ。
// 外の API は、便を探す飛行機の区間があるときに、時刻表（ODPT。料金はかからない）を読むだけ。その待ち（最大 20 秒）が収まる長さにする
export const restorePlace = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, pinId } = (request.data ?? {}) as Record<string, unknown>
  if (![tripId, pinId].every((id): id is string => typeof id === 'string' && ID.test(id))) {
    throw new HttpsError('invalid-argument', '旅と、戻す場所を指定してください')
  }
  const result = await restorePlaceUsecase({ db: firestore(), flights: odptFlights }, { tripId: tripId as string, pinId: pinId as string, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', '場所が見つかりません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  if (result.status === 'not-built') throw new HttpsError('failed-precondition', 'まだ建っていない場所は戻せません')
  return result
})
