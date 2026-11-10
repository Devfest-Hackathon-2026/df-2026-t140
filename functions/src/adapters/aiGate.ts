import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import {
  AI_ACCESS_COLLECTION,
  ARGON_DAILY_MAX,
  ARGON_TOTAL_MAX,
  budgetDay,
  FLASH_TOTAL_MAX,
  readCount,
  readOpenToAll,
  refundArgon,
  refundedCount,
  reserveArgon,
  SETTINGS_AI_DOC,
  SETTINGS_COLLECTION,
  USAGE_ARGON_DOC,
  USAGE_COLLECTION,
  USAGE_FLASH_DOC,
  withinFlashBudget,
} from '../domain/geminiBudget'
import type { AiGatePort } from '../ports/aiGate'

/**
 * 費用のかかる Gemini（vertex）の関所の実体。Firestore で、合言葉を通した人（aiAccess/{uid}）と
 * Flash の累計の回数（usage/flash）と Argon の日ごと・累計の回数（usage/argon）を見る。判断の決まりは domain/geminiBudget.ts。
 *
 * 回数は「呼ぶ前に数える」。失敗した呼び出しも数える（費用側に倒す）。
 * 呼び出し口（adapters/gemini/index.ts）は形が違うと 1 回やり直すので、1 回分の予約で最大 2 回呼ぶことがある。
 * 上限は約 3 ドルの目安なので、この誤差は許す。
 * 設定の誤り（401、403、404）で 1 回目から呼べなかったときだけ、数えた 1 回を戻す（refundFlashCall）
 */
export function aiGate(db: Firestore): AiGatePort {
  const usage = db.collection(USAGE_COLLECTION).doc(USAGE_FLASH_DOC)
  const argonUsage = db.collection(USAGE_COLLECTION).doc(USAGE_ARGON_DOC)
  return {
    async isOpenToAll() {
      const snapshot = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_AI_DOC).get()
      const open = readOpenToAll(snapshot.get('openToAll'))
      if (open) console.info('settings/ai の openToAll が入っているので、合言葉なしで本物の Gemini を使います')
      return open
    },
    async isUnlocked(uid) {
      const snapshot = await db.collection(AI_ACCESS_COLLECTION).doc(uid).get()
      return snapshot.exists
    },
    async reserveFlashCall() {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(usage)
        const used = readCount(snapshot.get('count'))
        if (!withinFlashBudget(used, FLASH_TOTAL_MAX)) {
          console.warn(`Vertex の Flash が累計の上限（${FLASH_TOTAL_MAX}）に達しています：${used} 回`)
          return false
        }
        tx.set(usage, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        return true
      })
    },
    async refundFlashCall() {
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(usage)
        if (!snapshot.exists) return
        const count = refundedCount(snapshot.get('count'))
        if (count === null) return
        tx.set(usage, { count, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      })
    },
    async reserveArgonCall() {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(argonUsage)
        const next = reserveArgon(snapshot.data() ?? {}, budgetDay(new Date()))
        if (!next) {
          console.warn(
            `Vertex の Argon が上限（1 日 ${ARGON_DAILY_MAX} 回、累計 ${ARGON_TOTAL_MAX} 回）に達しています：` +
              `累計 ${String(snapshot.get('count'))} 回、${String(snapshot.get('day'))} は ${String(snapshot.get('dayCount'))} 回`,
          )
          return false
        }
        tx.set(argonUsage, { ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        return true
      })
    },
    async refundArgonCall() {
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(argonUsage)
        if (!snapshot.exists) return
        const next = refundArgon(snapshot.data() ?? {}, budgetDay(new Date()))
        if (!next) return
        tx.set(argonUsage, { ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      })
    },
  }
}
