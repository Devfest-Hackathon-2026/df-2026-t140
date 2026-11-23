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
  catchphraseEn?: string
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

/**
 * しおりが時間に収まらないとき、場所に「残したい順」を付けてもらう入力（#622）。
 * 外す数は Functions が時間の計算で決める（domain/dropToFit.ts）。Gemini には時間を見積もらせず、
 * いる時間、近い場所のまとまり、ほかのまとまりからの片道を、こちらで計算して渡す。
 * 希望を書いた人は「人1」「人2」のような呼び名にして、名前や ID は送らない
 */
export interface RankPlacesInput {
  tripTitle: string
  days: number
  originName: string
  /** 今のままで 19 時を越える分の合計（分） */
  overMinutes: number
  places: RankPlace[]
}

export interface RankPlace {
  id: string
  name: string
  category: PinCategory | 'other'
  /** いる時間の目安（分） */
  stay: number
  /** 希望を書いた人の呼び名（人1、人2…） */
  wisher: string
  /** 近い場所のまとまり（g1、g2…）。片道 2 時間以内でつながる場所は同じまとまり */
  group: string
  /** そのまとまりへ、ほかのまとまりから行く片道（分）。まとまりが 1 つなら 0 */
  reach: number
}

export interface RankPlacesOutput {
  /** 残したい順（場所の ID。先頭ほど残したい）。stub は空（自分たちの計算の順を使う） */
  ranking: string[]
}
