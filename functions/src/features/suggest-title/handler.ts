import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { currentProvider, gemini, needsPermit } from '../../adapters/gemini'
import { readTitleInput } from './logic'
import { suggestTitle as suggest } from './usecase'

// 旅をつくる画面の「Gemini におまかせ」で、最後の問いで地方を選んだときに呼ぶ（旅を作る前なので、旅の書き込みではなく画面から呼ぶ）。
// Gemini は必ず adapters/gemini の呼び出し口を通す（既定は固定の応答）。agy の Flash は 1 回最大 150 秒で、形が違えば 1 回やり直す
export const suggestTripTitle = onCall({ timeoutSeconds: 330 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const input = readTitleInput(request.data)
  if (!input) throw new HttpsError('invalid-argument', '日程、出発地、乗り物、行き先を指定してください')
  const db = firestore()
  return suggest({ gemini, aiGate: aiGate(db) }, input, request.auth.uid, { guarded: needsPermit(currentProvider()) })
})
