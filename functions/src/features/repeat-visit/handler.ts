import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { STOP_ID } from '../../domain/visit'
import { repeatVisit as repeatVisitUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

// しおりの場所の行を複製する（すぐ下に同じ場所の行を足す）、または同じ場所の行を 1 つ消して、しおりを作り直す（usecase.ts）。
// 同じ場所を旅の中で何度も訪れられるようにするためのもの（スキー場に 2 日続けて行く、宿に毎晩戻る、など。#528）。
// ルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。旅のメンバーだけ。
// 外の API は、便を探す飛行機の区間があるときに、時刻表（ODPT。料金はかからない）を読むだけ。その待ち（最大 20 秒）が収まる長さにする
export const repeatVisit = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId, stopId, remove } = (request.data ?? {}) as Record<string, unknown>
  const valid =
    typeof tripId === 'string' && ID.test(tripId) && typeof routeId === 'string' && ID.test(routeId)
    && typeof stopId === 'string' && STOP_ID.test(stopId) && typeof remove === 'boolean'
  if (!valid) throw new HttpsError('invalid-argument', '旅としおりと、複製する（消す）行を指定してください')
  const result = await repeatVisitUsecase({ db: firestore(), flights: odptFlights }, { tripId, routeId, stopId, remove, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  if (result.status === 'not-found') throw new HttpsError('not-found', 'しおりが見つかりません')
  if (result.status === 'confirmed') throw new HttpsError('failed-precondition', '旅程が確定しているので、変えられません')
  return result
})
