import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { GeminiPort } from '../../ports/gemini'

/** 希望 → ピンが外の世界に頼むもの。handler が adapters の実体を渡す */
export interface SuggestPlacesPorts {
  db: Firestore
  gemini: GeminiPort
  /** 費用のかかる Gemini（vertex）を呼ぶ前の関所（合言葉と回数の上限） */
  aiGate: AiGatePort
}
