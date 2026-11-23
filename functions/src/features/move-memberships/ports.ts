import type { Firestore } from 'firebase-admin/firestore'

/** 引き継ぎが外の世界に頼むもの。handler が adapters の実体を渡す */
export interface MoveMembershipsPorts {
  db: Firestore
}
