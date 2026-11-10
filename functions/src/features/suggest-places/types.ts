import type { LatLng, PinCategory } from '../../domain/pin'
import type { MapBounds } from '../../domain/wish'

/** Gemini に渡すもの。利用者の言葉と、地図で映していた範囲だけ。Maps の情報は渡さない */
export interface SuggestInput {
  /** 「温泉に入りたい」「新潟の温泉！」など */
  text: string
  /** 地図で映していた範囲。null は日本全体 */
  bounds: MapBounds | null
  /** この旅にもうあるピンの名前。同じ場所を 2 回出さない */
  exclude: string[]
}

/** 候補の場所 1 つ */
export interface SuggestedPlace {
  name: string
  /** 一言の説明 */
  description: string
  /** 「長野県安曇野市」など */
  area: string
  category: PinCategory
  location: LatLng
}

export interface SuggestOutput {
  places: SuggestedPlace[]
}
