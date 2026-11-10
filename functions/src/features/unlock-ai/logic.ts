import type { UnlockAiResult, UnlockAttempts } from './types'

// SDK を import しない純粋な判断。合言葉が合うかを決める。

/** 合言葉の長さの上限。長い入力で時間を使わせない */
export const PASSPHRASE_MAX = 64

/**
 * 入力の合言葉が、設定した合言葉と合うか。
 * 設定がなければ（本番で人がまだ入れていない、手元で付けていない）必ず断る（費用側に倒す）。
 * 比べる時間が中身で変わらないよう、長さが違っても最後まで見る
 */
export function decideUnlock(given: unknown, expected: string | undefined): UnlockAiResult {
  const secret = expected?.trim() ?? ''
  if (secret.length === 0) return 'not-configured'
  if (typeof given !== 'string' || given.length === 0 || given.length > PASSPHRASE_MAX) return 'invalid'
  const value = given.trim()
  let mismatch = value.length === secret.length ? 0 : 1
  for (let index = 0; index < secret.length; index += 1) {
    mismatch |= secret.charCodeAt(index) ^ (value.charCodeAt(index % Math.max(value.length, 1)) || 0)
  }
  return mismatch === 0 ? 'ok' : 'wrong'
}

/** 続けて間違えてよい回数。これだけ間違えると、しばらく断る（総当たりで本物の AI を使わせない） */
export const UNLOCK_FAILURE_MAX = 5

/** 断る長さ。最後に間違えてからこの時間がたつと、回数を数え直す */
export const UNLOCK_LOCK_MS = 60 * 60 * 1000

/** 記録の値を回数にする。壊れていれば上限扱い（費用側に倒す） */
export function readAttempts(data: unknown): UnlockAttempts {
  if (data === undefined || data === null) return { failures: 0, lastFailedAt: 0 }
  const { failures, lastFailedAt } = data as { failures?: unknown; lastFailedAt?: unknown }
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  return {
    failures: valid(failures) ? failures : UNLOCK_FAILURE_MAX,
    lastFailedAt: valid(lastFailedAt) ? lastFailedAt : Number.MAX_SAFE_INTEGER,
  }
}

/** 最後に間違えてから時間がたっていれば、回数を 0 に戻した記録にする */
function current(attempts: UnlockAttempts, now: number): UnlockAttempts {
  return now - attempts.lastFailedAt >= UNLOCK_LOCK_MS ? { failures: 0, lastFailedAt: 0 } : attempts
}

/** 今は断る時間か。UNLOCK_FAILURE_MAX 回間違えてから UNLOCK_LOCK_MS のあいだは、合言葉を見ずに断る */
export function isLockedOut(attempts: UnlockAttempts, now: number): boolean {
  return current(attempts, now).failures >= UNLOCK_FAILURE_MAX
}

/** 間違えたあとの記録。時間がたっていれば 1 から数え直す */
export function recordFailure(attempts: UnlockAttempts, now: number): UnlockAttempts {
  return { failures: current(attempts, now).failures + 1, lastFailedAt: now }
}
