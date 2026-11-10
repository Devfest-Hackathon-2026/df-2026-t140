import type { PinCategory } from '../../domain/pin'
import type { RouteStyle } from '../../domain/route'
import type { PlanOrigin, PlanPlace } from '../../domain/routePlan'

/** ルート案を考える入力。建った場所と、旅の基本情報だけ。Maps 由来の内容（place_id、Routes の結果）は入れない */
export interface ProposeRoutesInput {
  tripTitle: string
  origin: PlanOrigin
  /** 旅の日数（日帰りは 1） */
  days: number
  places: ProposePlace[]
}

export interface ProposePlace extends PlanPlace {
  category: PinCategory
}

/** 案 1 つ。回る順番とキャッチコピーまで。時刻と移動時間は、Functions が順番から計算する（domain/routePlan.ts） */
export interface ProposedOption {
  style: RouteStyle
  /** 「湯けむりと雪山、最短でめぐる旅」など。1〜40 文字 */
  catchphrase: string
  /** 回る順番（ピンの ID）。入力の場所を、すべて 1 回ずつ */
  pinIds: string[]
}

export interface ProposeRoutesOutput {
  options: ProposedOption[]
}

export type UpdateRoutesResult =
  /** ルート案を作った（作り直した） */
  | 'proposed'
  /** 決まったルートに、建った場所を足して組み直した */
  | 'rerouted'
  /** 何もしなかった（場所が足りない、もう同じ場所で作ってある、足す場所がない） */
  | 'skipped'
