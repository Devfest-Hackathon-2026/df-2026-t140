/** 建築の依頼の結果。ok 以外は、断った理由 */
export type RequestBuildResult =
  | 'ok'
  /** 旅のメンバーではない */
  | 'not-member'
  /** 旅程が確定している（確定しているあいだは建てない。features/confirm-shiori） */
  | 'confirmed'
  /** ピンがない */
  | 'not-found'
  /** もう工事中か、完成している */
  | 'already-built'
  /** 旅ごとの上限（20 棟）に達している */
  | 'limit-reached'
