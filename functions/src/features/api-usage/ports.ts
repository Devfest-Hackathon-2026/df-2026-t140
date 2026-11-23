import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'

/** 使用量を読むときに外の世界に頼むもの。handler が adapters の実体を渡す */
export interface ApiUsagePorts {
  db: Firestore
  /** 合言葉を通しているかを聞くのに使う（aiAccess/{uid}） */
  aiGate: Pick<AiGatePort, 'isUnlocked'>
}
