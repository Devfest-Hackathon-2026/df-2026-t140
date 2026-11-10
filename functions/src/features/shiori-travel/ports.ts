import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { RoutesApiPort } from '../../ports/routes-api'

/** しおりの移動時間を聞く処理が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface ShioriTravelPorts {
  db: Firestore
  /** 全員に開く切り替え（settings/ai）と、合言葉を通しているか（aiAccess/{uid}）だけを見る。Gemini の回数は数えない */
  aiGate: Pick<AiGatePort, 'isOpenToAll' | 'isUnlocked'>
  /** Google の Routes API（移動時間） */
  routesApi: RoutesApiPort
}
