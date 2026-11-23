import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { STOP_ID } from '../../domain/visit'
import { reorderShiori as reorderShioriUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// しおりの行を取り、別の行に落としたときに、取った行を落とした先の位置に差し込んで、しおりを作り直す（usecase.ts）。
// ルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。旅のメンバーだけ。
// 外の API は、便を探す飛行機の区間があるときに、時刻表（ODPT。料金はかからない）を読むだけ。その待ち（最大 20 秒）が収まる長さにする
export const reorderShiori = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId, fromPinId, toPinId } = (request.data ?? {}) as Record<string, unknown>
  const valid = [tripId, routeId].every((id) => typeof id === 'string' && ID.test(id))
    && [fromPinId, toPinId].every((id) => typeof id === 'string' && STOP_ID.test(id))
  if (!valid) {
    throw new HttpsError('invalid-argument', '旅としおりと、動かす行と落とす先の行を指定してください')
  }
  const result = await reorderShioriUsecase(
    { db: firestore(), flights: odptFlights },
    { tripId: tripId as string, routeId: routeId as string, fromPinId: fromPinId as string, toPinId: toPinId as string, uid: request.auth.uid },
  )
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', 'しおりが見つかりません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  if (result.status === 'invalid') throw new HttpsError('failed-precondition', 'しおりにない行と、イベントの行は動かせません')
  return result
})
