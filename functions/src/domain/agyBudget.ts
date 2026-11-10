// 手元の agy（Antigravity CLI）で本物の Gemini を呼ぶ回数の上限。純粋な判断だけを置く。
// 数える・記録する I/O は adapters/gemini/agy.ts。
//
// 技術構成の「費用の上限」（Flash は累計 300 回）より小さい、開発者 1 人の 1 日の上限。
// agy は開発者の Antigravity アカウントのクォータで動くので、費用は出ないが、使い切ると開発に支障が出る。

/** AGY_MAX_CALLS を書かないときの、1 日の上限（Flash） */
export const DEFAULT_AGY_MAX_CALLS = 30

/**
 * AGY_MAX_ARGON_CALLS を書かないときの、1 日の上限（Argon、模型）。
 * 技術構成の Argon の上限（1 日 20 回）に合わせる。Flash とは別に数える
 */
export const DEFAULT_AGY_MAX_ARGON_CALLS = 20

/** 回数を数える財布。Flash と Argon は別々に数える */
export type AgyPool = 'flash' | 'argon'

/** 環境変数の値を上限の数にする。数でない、負の数、空は既定にする（0 は「呼ばない」として通す） */
export function parseMaxCalls(value: string | undefined, fallback: number = DEFAULT_AGY_MAX_CALLS): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return fallback
  return parsed
}

/** もう used 回使っていて、次の 1 回を呼んでよいか */
export function withinBudget(used: number, max: number): boolean {
  return used < max
}

/** 日付ごとの記録の名前（手元の時刻の日付）。Emulator を立て直しても同じ日なら同じ記録を数える */
export function budgetKey(now: Date, pool: AgyPool = 'flash'): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const name = pool === 'argon' ? 'konbu-agy-argon-calls' : 'konbu-agy-calls'
  return `${name}-${yyyy}-${mm}-${dd}.json`
}
