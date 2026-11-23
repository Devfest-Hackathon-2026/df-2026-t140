import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { FlightsPort } from '../../ports/flights'
import type { GeminiPort } from '../../ports/gemini'

/** ルート案を作る処理が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface ProposeRoutesPorts {
  db: Firestore
  gemini: GeminiPort
  /** 費用のかかる Gemini（vertex）を呼ぶ前の関所（合言葉と回数の上限） */
  aiGate: AiGatePort
  /** 飛行機の時刻表（ODPT。料金はかからない）。しおりに、便を探す飛行機の区間があるときだけ読む */
  flights: FlightsPort
}
