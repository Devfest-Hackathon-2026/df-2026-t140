import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { GeminiPort } from '../../ports/gemini'
import type { PlacesApiPort } from '../../ports/places-api'

/** 希望 → ピンが外の世界に頼むもの。handler が adapters の実体を渡す */
export interface SuggestPlacesPorts {
  db: Firestore
  gemini: GeminiPort
  /** 費用のかかる Gemini（vertex）を呼ぶ前の関所（合言葉と回数の上限） */
  aiGate: AiGatePort
  /** 宿さがしの候補を確かめる Places（テキスト検索）。呼べる設定（本番でキーがある）で、希望を書いた人が合言葉を通しているときだけ呼ぶ */
  placesApi?: Pick<PlacesApiPort, 'enabled' | 'findLodging'>
}
