import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { gemini } from '../../adapters/gemini'
import { ping } from './logic'

// 接続確認用。Gemini は必ず adapters/gemini の呼び出し口を通す（GEMINI_PROVIDER で切り替え。既定は固定の応答）。
export const pingGemini = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'ログインが必要です')
  }
  return ping({ gemini })
})
