/**
 * ok：合った。aiAccess/{uid} に記録した。
 * wrong：合わない。invalid：入力が文字列でない、空、長すぎる。
 * not-configured：合言葉がまだ設定されていない（本番は人が入れる。todo/humans）。
 * locked：何度も間違えたので、しばらく断る（合っていても断る。logic の UNLOCK_FAILURE_MAX）。
 */
export type UnlockAiResult = 'ok' | 'wrong' | 'invalid' | 'not-configured' | 'locked'

/** 合言葉を間違えた記録（unlockAttempts/{uid}）。端末からは読み書きできない（firestore.rules に書かない） */
export interface UnlockAttempts {
  /** 続けて間違えた回数 */
  failures: number
  /** 最後に間違えた時刻（ミリ秒） */
  lastFailedAt: number
}
