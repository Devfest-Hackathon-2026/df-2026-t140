/** 建築の依頼の結果。ok 以外は、断った理由 */
export type RequestBuildResult =
  | 'ok'
  /** 旅のメンバーではない */
  | 'not-member'
  /** ピンがない */
  | 'not-found'
  /** もう工事中か、完成している */
  | 'already-built'
  /** 旅ごとの上限（20 棟）に達している */
  | 'limit-reached'
