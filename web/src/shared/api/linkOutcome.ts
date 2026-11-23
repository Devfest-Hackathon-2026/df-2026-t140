// Google アカウントとの連携の結果を、ログインの画面との行き来や読み込み直しをまたいで覚えるときの形。
// SDK を import しない（確認テストから読めるように）。覚える・読むのは account.ts。

/**
 * 読み込み直したあと（ログインの画面から戻ったあと）の画面で知らせる結果。
 * failed の code は、できなかった理由（Firebase のエラーのコード）。分からなければ null
 */
export type LinkOutcome = { kind: 'linked' } | { kind: 'switched' } | { kind: 'failed'; code: string | null }

/** 結果を、覚えておく文字にする。失敗の理由が文字でなければ、理由なしの失敗にする */
export function encodeLinkOutcome(outcome: { kind: 'linked' | 'switched' } | { kind: 'failed'; code?: unknown }): string {
  if (outcome.kind !== 'failed') return outcome.kind
  return `failed:${typeof outcome.code === 'string' ? outcome.code : ''}`
}

/** 覚えた文字を結果にする。知らない値は null（壊れた値で画面を止めない） */
export function parseLinkOutcome(value: string | null): LinkOutcome | null {
  if (value === 'linked' || value === 'switched') return { kind: value }
  if (value?.startsWith('failed')) return { kind: 'failed', code: value.slice('failed:'.length) || null }
  return null
}
