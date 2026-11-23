import type { MealKind } from '../../domain/meal'
import type { LatLng, PinCategory } from '../../domain/pin'
import type { MapBounds } from '../../domain/wish'
import type { LodgingKind, LodgingSide } from './logic/lodgingPlan'

/**
 * 宿さがしで Gemini に添える、その夜のしおりの様子（logic/lodgingPlan.ts の lodgingContext から作る）。
 * 送るのは、しおりの場所の名前（Gemini か人が書いたもの）と時刻と移動の手段だけ。Maps から取った情報は入れない
 */
export interface LodgingPromptContext {
  /** 何日目の夜か */
  night: number
  /** 泊まる側。stay は最後の場所の近く、move は翌日の場所の近く、between は 2 つのあいだ、route は車で向かう道の途中の着ける所ならどこでも */
  side: LodgingSide
  /** その日の最後の場所と、そこを出る時刻（HH:MM） */
  fromName: string
  leaveAt: string
  /** 翌日の最初の場所。なければ null */
  nextName: string | null
  /** 最後の場所から翌日の場所への移動の手段。翌日の場所がなければ null */
  moveMode: 'transit' | 'car' | 'walk' | 'plane' | null
  /** 旅全体の手段 */
  tripMode: 'transit' | 'car'
  /** ホテルに着く時刻の上限（HH:MM）。ふつうは 21:00。予定が遅くまで続く夜は、最後の場所を出てから 30 分後（logic/lodgingPlan.ts の hotelArriveBy） */
  hotelBy: string
}

/** Gemini に渡すもの。利用者の言葉と、地図で映していた範囲だけ。Maps の情報は渡さない */
export interface SuggestInput {
  /** 「温泉に入りたい」「新潟の温泉！」など */
  text: string
  /** 地図で映していた範囲。null は日本全体 */
  bounds: MapBounds | null
  /** この旅にもうあるピンの名前。同じ場所を 2 回出さない */
  exclude: string[]
  /**
   * 候補を出してよい県の名前（旅を作った人が選んだ地方の県、県まで絞ったときはその県）。
   * この中の場所だけを出す。null か、ないときは絞らない（#373。domain/region.ts の allowedPrefectures）
   */
  prefectures?: string[] | null
  /**
   * 宿さがしか（しおりの「宿を探す」から書いた希望か、文に「宿」「ホテル」「泊まりたい」などがある。logic の wantsLodging）。
   * true なら、泊まれる場所だけを、探す範囲の真ん中に近い順に出す。候補のピンの種類は lodging にする
   */
  lodging?: boolean
  /** 宿さがしで、しおりから読んだその夜の様子。しおりがないときはない（地図の範囲だけで探す） */
  lodgingContext?: LodgingPromptContext
  /**
   * ごはんのお店さがしか（しおりのごはんの枠の「お店を探す」から書いた希望）。朝・昼・晩のどれか。
   * あれば、その時間に食べられるお店だけを、探す範囲の真ん中に近い順に出す。候補のピンの種類は food にする
   */
  meal?: MealKind
}

/** 候補の場所 1 つ */
export interface SuggestedPlace {
  name: string
  nameEn?: string
  /** 希望で具体的に指定された施設 */
  namedMatch?: true
  /** 一言の説明 */
  description: string
  descriptionEn?: string
  /** 「長野県安曇野市」など */
  area: string
  areaEn?: string
  category: PinCategory
  location: LatLng
  /** Places で確かめた宿の place_id（宿さがしのとき、本番で確かめられたものだけ） */
  placeId?: string
  /** 宿さがしの候補の種類（夕食付きの旅館か、それ以外か）。着く時刻の上限を分けるのに使う。分からなければない（ホテルとして扱う） */
  lodgingKind?: LodgingKind
}

export interface SuggestOutput {
  places: SuggestedPlace[]
}
