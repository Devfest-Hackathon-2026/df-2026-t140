import type { GeminiPort } from '../../ports/gemini'

/** ping が外の世界に頼むもの。handler が adapters の実装を渡す */
export interface PingPorts {
  gemini: GeminiPort
}
