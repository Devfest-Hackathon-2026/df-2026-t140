import type { Firestore } from 'firebase-admin/firestore'

/** 合言葉の確認が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface UnlockAiPorts {
  db: Firestore
}
