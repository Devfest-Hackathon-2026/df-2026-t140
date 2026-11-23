import type { AiGatePort } from '../../ports/aiGate'
import type { GeminiPort } from '../../ports/gemini'

/** 旅の名前を考えるときに外の世界に頼むもの。handler が adapters の実体を渡す */
export interface SuggestTitlePorts {
  gemini: GeminiPort
  /** 費用のかかる Gemini（vertex）を呼ぶ前の関所（合言葉と Flash の累計の上限） */
  aiGate: AiGatePort
}
