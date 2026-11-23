/**
 * 旅の合言葉を作った結果。
 * not-member：その旅のメンバーではない（旅がないときも同じ。旅があるかを教えない）。
 * busy：空いている合言葉を見つけられなかった（もう一度頼めば通る）。
 */
export type IssueJoinCodeResult = { status: 'ok'; joinCode: string } | 'not-member' | 'busy'

/**
 * 旅の合言葉から旅を引いた結果。
 * invalid：合言葉の形になっていない。not-found：その合言葉の旅がない。
 * locked：何度も間違えたので、しばらく断る（合っていても断る。logic の JOIN_CODE_FAILURE_MAX）。
 */
export type FindTripResult = { status: 'ok'; tripId: string } | 'invalid' | 'not-found' | 'locked'

/** 合言葉を間違えた記録（joinCodeAttempts/{uid}）。端末からは読み書きできない（firestore.rules に書かない） */
export interface JoinCodeAttempts {
  /** 続けて間違えた回数 */
  failures: number
  /** 最後に間違えた時刻（ミリ秒） */
  lastFailedAt: number
}
