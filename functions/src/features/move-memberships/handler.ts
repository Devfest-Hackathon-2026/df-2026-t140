import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { anonymousUidOf } from '../../adapters/auth'
import { firestore } from '../../adapters/firestore'
import type { MoveMembershipsRefusal, MoveMembershipsResult } from './types'
import { moveMemberships as moveMembershipsUsecase } from './usecase'

/** トークンの長さの上限。長い入力で時間を使わせない */
const TOKEN_MAX = 4096

/** 断った理由を、画面に出せる形（コードと文）にする */
const REFUSALS: Record<MoveMembershipsRefusal, HttpsError> = {
  'invalid-token': new HttpsError('permission-denied', '前のログインを確かめられませんでした'),
  same: new HttpsError('failed-precondition', '同じ人どうしでは引き継げません'),
}

// Google アカウントでログインして別の人（uid）になったときに、その端末で名前だけで参加していた旅を引き継ぐ。
// 呼ぶのは今の自分（画面からは Google アカウントに切り替わった直後に呼ぶ。ログインの種類は確かめない）。
// 前の自分（匿名）の本人である証拠として、前の自分の ID トークンを渡すので、他人の旅は動かせない。
// 引き継げるのは匿名ログインの人からだけ（Google アカウントの人の旅を、ほかの人へ動かさない）。
// Gemini も Maps も呼ばない。
export const moveMemberships = onCall({ timeoutSeconds: 60 }, async (request): Promise<MoveMembershipsResult> => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { fromIdToken } = (request.data ?? {}) as { fromIdToken?: unknown }
  if (typeof fromIdToken !== 'string' || fromIdToken.length === 0 || fromIdToken.length > TOKEN_MAX) {
    throw new HttpsError('invalid-argument', '前のログインを指定してください')
  }

  const fromUid = await anonymousUidOf(fromIdToken)
  if (!fromUid) throw REFUSALS['invalid-token']
  if (fromUid === request.auth.uid) throw REFUSALS.same

  const moved = await moveMembershipsUsecase({ db: firestore() }, { fromUid, toUid: request.auth.uid })
  return { moved }
})
