import type { Firestore } from 'firebase-admin/firestore'

/** 投票の集計が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface TallyVotesPorts {
  db: Firestore
}
