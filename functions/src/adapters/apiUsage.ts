import { FieldValue } from 'firebase-admin/firestore'
import { API_USAGE_DOC, apiUsageDay, type CountedApi, countedRecord } from '../domain/apiUsage'
import { USAGE_COLLECTION } from '../domain/geminiBudget'
import { firestore } from './firestore'

/**
 * Maps 系の API を 1 回呼んだと数える（usage/<API> の日ごとの回数）。外へ fetch する直前に呼ぶ。
 * 画面の使用量の表示（features/api-usage）のための数で、上限で止めるのは Google Cloud の割り当て。
 * そのため、数えるのに失敗しても投げない（API の呼び出しを止めない）。決まりは domain/apiUsage.ts
 */
export async function countApiCall(api: CountedApi, now: Date = new Date()): Promise<void> {
  try {
    const ref = firestore().collection(USAGE_COLLECTION).doc(API_USAGE_DOC[api])
    await firestore().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref)
      tx.set(ref, { ...countedRecord(snapshot.data(), apiUsageDay(now)), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
  } catch (cause) {
    console.warn(`API の回数（${api}）を数えられませんでした。呼び出しはそのまま続けます`, cause)
  }
}
