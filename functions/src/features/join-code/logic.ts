import type { JoinCodeAttempts } from './types'

// SDK を import しない純粋な判断。合言葉を間違えた回数を数える。
// 旅の合言葉は招待リンクの ID より短いので、総当たりで知らない旅に入られないよう、間違えてよい回数を限る。

/** 間違えてよい回数。これだけ間違えると、しばらく断る。打ち間違いで止まりにくいよう、余裕を持たせる */
export const JOIN_CODE_FAILURE_MAX = 10

/** 断る長さ。最後に間違えてからこの時間がたつと、回数を数え直す */
export const JOIN_CODE_LOCK_MS = 60 * 60 * 1000

/** 空いている合言葉を探し直す回数 */
export const JOIN_CODE_ISSUE_TRIES = 5

/** 記録の値を回数にする。壊れていれば上限扱い（断る側に倒す） */
export function readAttempts(data: unknown): JoinCodeAttempts {
  if (data === undefined || data === null) return { failures: 0, lastFailedAt: 0 }
  const { failures, lastFailedAt } = data as { failures?: unknown; lastFailedAt?: unknown }
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  return {
    failures: valid(failures) ? failures : JOIN_CODE_FAILURE_MAX,
    lastFailedAt: valid(lastFailedAt) ? lastFailedAt : Number.MAX_SAFE_INTEGER,
  }
}

/** 最後に間違えてから時間がたっていれば、回数を 0 に戻した記録にする */
function current(attempts: JoinCodeAttempts, now: number): JoinCodeAttempts {
  return now - attempts.lastFailedAt >= JOIN_CODE_LOCK_MS ? { failures: 0, lastFailedAt: 0 } : attempts
}

/** 今は断る時間か。JOIN_CODE_FAILURE_MAX 回間違えてから JOIN_CODE_LOCK_MS のあいだは、合言葉を見ずに断る */
export function isLockedOut(attempts: JoinCodeAttempts, now: number): boolean {
  return current(attempts, now).failures >= JOIN_CODE_FAILURE_MAX
}

/**
 * 間違えたあとの記録。時間がたっていれば 1 から数え直す。
 * 合っても回数は戻さない（知っている合言葉を 1 つ挟めば何度でも試せる、とならないように）
 */
export function recordFailure(attempts: JoinCodeAttempts, now: number): JoinCodeAttempts {
  return { failures: current(attempts, now).failures + 1, lastFailedAt: now }
}
