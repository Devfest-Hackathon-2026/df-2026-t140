import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import type { UnlockAiResult } from './types'
import { unlockAi as unlockAiUsecase } from './usecase'

/** 断った理由を、画面に出せる形（コードと文）にする */
const REFUSALS: Record<Exclude<UnlockAiResult, 'ok'>, HttpsError> = {
  wrong: new HttpsError('permission-denied', '合言葉が違います'),
  invalid: new HttpsError('invalid-argument', '合言葉を入れてください'),
  'not-configured': new HttpsError('failed-precondition', '合言葉はまだ使えません'),
  locked: new HttpsError('resource-exhausted', '合言葉を何度も間違えたので、しばらく使えません'),
}

// 合言葉で、本物の AI（Cloud の Gemini）を自分の希望で使えるようにする。
// 合言葉の値は環境変数 AI_PASSPHRASE（本番は人が GitHub の Secret に入れ、Deploy が関数の環境に渡す。
// リポジトリには書かない。todo/humans/2026-11-07-vertex-gemini-passphrase.md）。
// 設定がなければ必ず断る。何度も間違えたら、しばらく断る（総当たりを防ぐ）。Gemini はここでは呼ばない。
export const unlockAi = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { passphrase } = (request.data ?? {}) as { passphrase?: unknown }

  const result = await unlockAiUsecase(
    { db: firestore() },
    { uid: request.auth.uid, passphrase, expected: process.env.AI_PASSPHRASE, now: Date.now() },
  )
  if (result !== 'ok') throw REFUSALS[result]
  return { status: 'unlocked' as const }
})
