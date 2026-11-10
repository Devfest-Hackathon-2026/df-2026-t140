import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { gemini, needsPermit, currentProvider } from '../../adapters/gemini'
import { suggestPlacesForWish } from './usecase'

// 希望（trips/{tripId}/wishes/{wishId}）が書かれたら、場所の候補を探してピンを書く。
// 希望を書けるのは旅のメンバーだけ（firestore.rules）なので、ログインの確認はルールが済ませている。
// Gemini は必ず adapters/gemini の呼び出し口を通す（既定は固定の応答＝見本の場所の一覧）。
// 費用のかかる経路（vertex）は、希望を書いた人が合言葉を通していて、回数の上限の中のときだけ呼ぶ（aiGate）。
// agy の Flash は 1 回最大 150 秒（adapters/gemini/agy.ts）で、形が違えば 1 回やり直す。その 2 回分（300 秒）が収まる長さにする
export const suggestPlaces = onDocumentCreated(
  { document: 'trips/{tripId}/wishes/{wishId}', timeoutSeconds: 330 },
  async (event) => {
    const { tripId, wishId } = event.params
    const db = firestore()
    await suggestPlacesForWish({ db, gemini, aiGate: aiGate(db) }, tripId, wishId, {
      guarded: needsPermit(currentProvider()),
    })
  },
)
