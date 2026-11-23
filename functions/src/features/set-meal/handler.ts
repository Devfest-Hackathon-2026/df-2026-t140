import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { MEAL_NOTE_MAX, parseMealKey } from '../../domain/meal'
import { setMeal as set } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/** しおりのごはんの枠を、お店を建てずに決める（「なし」「コンビニ」など）ことと、その取り消し。ルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。外の API は呼ばない */
export const setMeal = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId, slot, skip, note } = (request.data ?? {}) as Record<string, unknown>
  const valid =
    typeof tripId === 'string' && ID.test(tripId) && typeof routeId === 'string' && ID.test(routeId)
    && typeof slot === 'string' && parseMealKey(slot) !== null && typeof skip === 'boolean'
    && (note === undefined || note === null || (typeof note === 'string' && note.trim().length <= MEAL_NOTE_MAX))
  if (!valid) throw new HttpsError('invalid-argument', '旅としおりと、どの日のどのごはんかを指定してください')
  const result = await set({ db: firestore() }, { tripId, routeId, slot, skip, note: typeof note === 'string' ? note : null, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  return result
})
