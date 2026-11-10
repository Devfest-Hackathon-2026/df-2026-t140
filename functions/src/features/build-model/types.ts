import type { PinCategory } from '../../domain/pin'

/**
 * 模型を作る入力。利用者の言葉（希望の文）と、Gemini（か見本の一覧）が書いた名前と説明だけ。
 * Maps 由来の内容（place_id、Places の店名・住所・写真・口コミ）は、ここに入れない（Maps Platform 規約 3.2.3(c)）。
 */
export interface BuildModelInput {
  /** 場所の名前 */
  name: string
  /** 一言の説明 */
  description: string
  /** もとになった希望の文（「温泉に入りたい」）。分からなければ空 */
  wishText: string
  category: PinCategory
  /**
   * 名前で引いた参考の説明（Knowledge Graph Search API の detailedDescription。Wikipedia の文で CC BY-SA）。
   * なければ省く。Maps 由来ではない（名前は Gemini が Maps を使わずに出したもの）
   */
  reference?: string
}
