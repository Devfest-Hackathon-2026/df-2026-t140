import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { removeBuilding as removeBuildingUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// 場所カードの「建物を消す」で、建った建物を消し、しおりを組み直す（usecase.ts）。
// ピンとルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。旅のメンバーだけ。
// 外の API は、便を探す飛行機の区間があるときに、時刻表（ODPT。料金はかからない）を読むだけ。その待ち（最大 20 秒）が収まる長さにする
export const removeBuilding = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, pinId } = (request.data ?? {}) as Record<string, unknown>
  if (![tripId, pinId].every((id): id is string => typeof id === 'string' && ID.test(id))) {
    throw new HttpsError('invalid-argument', '旅と、消す建物を指定してください')
  }
  const result = await removeBuildingUsecase({ db: firestore(), flights: odptFlights }, { tripId: tripId as string, pinId: pinId as string, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', '建物が見つかりません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  if (result.status === 'not-built') throw new HttpsError('failed-precondition', 'まだ建っていない建物は消せません')
  return result
})
