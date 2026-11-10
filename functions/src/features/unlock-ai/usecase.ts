import { FieldValue } from 'firebase-admin/firestore'
import { AI_ACCESS_COLLECTION } from '../../domain/geminiBudget'
import { decideUnlock, isLockedOut, readAttempts, recordFailure } from './logic'
import type { UnlockAiPorts } from './ports'
import type { UnlockAiResult } from './types'

/** 合言葉を間違えた記録。端末からは読み書きできない（firestore.rules に書かないので拒否される） */
export const UNLOCK_ATTEMPTS_COLLECTION = 'unlockAttempts'

/**
 * 合言葉を確かめ、合えば aiAccess/{uid} に記録する。読む → logic で決める → 書く。
 * 記録があると、その人の希望で本物の Gemini（vertex）を呼んでよい（features/suggest-places）。
 * 同じ人が 2 回通しても、記録は 1 つ（set で上書き）。
 * 間違えた回数は unlockAttempts/{uid} に数え、何度も間違えたらしばらく断る（logic の UNLOCK_FAILURE_MAX）。
 * 同時に何度も送っても回数が飛ばないよう、読むのと書くのを 1 つのトランザクションにする。合ったら記録を消す
 */
export async function unlockAi(
  ports: UnlockAiPorts,
  input: { uid: string; passphrase: unknown; expected: string | undefined; now: number },
): Promise<UnlockAiResult> {
  const attemptsRef = ports.db.collection(UNLOCK_ATTEMPTS_COLLECTION).doc(input.uid)
  const accessRef = ports.db.collection(AI_ACCESS_COLLECTION).doc(input.uid)
  return ports.db.runTransaction(async (tx) => {
    const attempts = readAttempts((await tx.get(attemptsRef)).data())
    if (isLockedOut(attempts, input.now)) return 'locked'
    const result = decideUnlock(input.passphrase, input.expected)
    if (result === 'wrong') {
      tx.set(attemptsRef, recordFailure(attempts, input.now))
    } else if (result === 'ok') {
      tx.set(accessRef, { uid: input.uid, unlockedAt: FieldValue.serverTimestamp() }, { merge: true })
      tx.delete(attemptsRef)
    }
    return result
  })
}
