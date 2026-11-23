import type { Firestore } from 'firebase-admin/firestore'

/** 旅の合言葉が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface JoinCodePorts {
  db: Firestore
  /** 0 以上 max 未満の、推測できない整数 */
  random: (max: number) => number
}
