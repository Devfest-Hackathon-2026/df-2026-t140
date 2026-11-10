import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { GeminiPort } from '../../ports/gemini'
import type { KnowledgeGraphPort } from '../../ports/knowledge-graph'

/** 建築（模型を作る）が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface BuildModelPorts {
  db: Firestore
  gemini: GeminiPort
  /** 費用のかかる Gemini（vertex）を呼ぶ前の関所（合言葉と Argon の回数の上限） */
  aiGate: AiGatePort
  /** 場所の名前から、ライセンスの付いた説明（Wikipedia）を引く。本物の Gemini で作るときだけ使う */
  knowledgeGraph?: KnowledgeGraphPort
  /** 決めた時間だけ待つ */
  wait: (ms: number) => Promise<void>
  /** 固定の応答（部品の模型）のときに、「工事中」が見えるよう待つ時間（ms） */
  stubDelayMs: number
}
