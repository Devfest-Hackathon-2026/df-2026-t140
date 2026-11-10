import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { PlacesApiPort } from '../../ports/places-api'

/** 建てる場所 → Places で確かめる、が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface VerifyPlacePorts {
  db: Firestore
  /** 合言葉を通しているか、全員に開く切り替えが入っているか（回数は数えない。Places の上限は Cloud 側） */
  aiGate: Pick<AiGatePort, 'isOpenToAll' | 'isUnlocked'>
  placesApi: PlacesApiPort
}
