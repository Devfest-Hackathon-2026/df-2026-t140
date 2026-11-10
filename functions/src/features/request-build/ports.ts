import type { Firestore } from 'firebase-admin/firestore'

/** 建築の依頼が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface RequestBuildPorts {
  db: Firestore
}
