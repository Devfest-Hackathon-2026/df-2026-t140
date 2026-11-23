import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { BUILD_LIMIT_PER_TRIP } from '../../domain/pin'
import type { RequestBuildResult } from './types'
import { requestBuild as requestBuildUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/** 断った理由を、画面に出せる形（コードと文）にする */
const REFUSALS: Record<Exclude<RequestBuildResult, 'ok'>, HttpsError> = {
  'not-member': new HttpsError('permission-denied', 'この旅のメンバーではありません'),
  confirmed: new HttpsError('failed-precondition', '旅程が確定しているので、建てられません'),
  'not-found': new HttpsError('not-found', 'このピンが見つかりません'),
  'already-built': new HttpsError('failed-precondition', 'この場所は、もう建築がはじまっています'),
  'limit-reached': new HttpsError('resource-exhausted', `建築は、1 つの旅で ${BUILD_LIMIT_PER_TRIP} 棟までです`),
}

// 「建築する！」。ログインと入力を確かめ、ピンを「工事中」にして、すぐ返す（待たせない）。
// 模型は features/build-model のトリガーが裏で作る。Gemini はここでは呼ばない。
export const requestBuild = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, pinId } = (request.data ?? {}) as { tripId?: unknown; pinId?: unknown }
  if (typeof tripId !== 'string' || typeof pinId !== 'string' || !ID.test(tripId) || !ID.test(pinId)) {
    throw new HttpsError('invalid-argument', '旅とピンを指定してください')
  }

  const result = await requestBuildUsecase({ db: firestore() }, { tripId, pinId, uid: request.auth.uid })
  if (result !== 'ok') throw REFUSALS[result]
  return { status: 'building' as const }
})
