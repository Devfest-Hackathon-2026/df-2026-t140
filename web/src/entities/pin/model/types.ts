// Firestore のデータの型：trips/{tripId}/pins/{pinId}（その下の model/current は entities/model3d）
// Functions 側の同じ型は functions/src/domain/pin.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ（AI の結果を改ざんさせない）
import type { Timestamp } from 'firebase/firestore'
import type { GeminiProvider } from '@/shared/lib'

/** 候補 → 工事中 → 完成（失敗したら failed） */
export type PinStatus = 'candidate' | 'building' | 'done' | 'failed'

/**
 * 場所の種類。地図のピンの絵と、建てる模型の部品を選ぶのに使う。
 * onsen：温泉。ski：スキー場。food：食べもの。farm：農園・牧場。nightview：夜景・展望。
 * nature：自然。shrine：神社・寺・城。themepark：遊ぶところ。town：街歩き（どれでもないときもこれ）。
 * lodging：宿（旅館、ホテルなど）。建つと、しおりの泊まる夜の宿になる。
 */
export type PinCategory =
  | 'onsen'
  | 'ski'
  | 'food'
  | 'farm'
  | 'nightview'
  | 'nature'
  | 'shrine'
  | 'themepark'
  | 'town'
  | 'lodging'

export interface LatLng {
  lat: number
  lng: number
}

/** イベントの種類。fireworks：花火大会。tour：見学会 */
export type EventKind = 'fireworks' | 'tour'

/**
 * 時刻が決まったイベント（花火大会、見学会）の開催の情報（Pin.event。#581）。Functions 側は functions/src/domain/event.ts の PinEvent。
 * しおりでは、着く時刻（start − leadMinutes）と出る時刻（end）が固定され、開催日の日に並ぶ。人は時刻を直せず、行をドラッグで動かせない
 */
export interface PinEvent {
  kind: EventKind
  /** 開催日（YYYY-MM-DD） */
  date: string
  /** 始まり（0 時からの分） */
  start: number
  /** 終わり（0 時からの分） */
  end: number
  /** 始まりの何分前に着いておくか */
  leadMinutes: number
  /** 出典の名前 */
  source: string
}

export interface Pin {
  /** もとになった希望 */
  wishId: string
  /** 希望を書いた人 */
  uid: string
  name: string
  nameEn?: string
  /** 希望で具体的に指定された場所の候補 */
  namedMatch?: true
  description: string
  descriptionEn?: string
  /** 「長野県安曇野市」など。Gemini（か見本の一覧）が書いたもの。Maps から取ったものではない */
  area: string
  areaEn?: string
  category: PinCategory
  location: LatLng
  status: PinStatus
  /** 候補を出したもの。stub は見本の場所の一覧（本物の Gemini ではない）。画面でそう分かるようにする */
  suggestedBy: GeminiProvider
  /** しおりの何日目の夜の宿として探したか（「宿を探す」を押した夜）。宿の候補にだけある */
  lodgingNight?: number
  /** しおりのどの日のどのごはんとして探したか（「1-lunch」）。ごはんの候補にだけある */
  mealSlot?: string
  /**
   * しおりの空いた時間への提案（Functions の features/suggest-fillers が立てる）にだけある。day は何日目の空きへの提案か。
   * dismissed は「無視」を押した印。提案の候補は wishId が FILLER_WISH_ID で、uid は空（建てると、建てた人のやりたいことになる）
   */
  filler?: { day: number; dismissed?: true }
  /** 時刻が決まったイベントの開催の情報。イベントの候補のピンにだけある */
  event?: PinEvent
  /** Places で確かめたときの place_id。店名や住所は表示のときに取り直す */
  placeId: string | null
  /** 「建築する！」を押した人 */
  builtBy: string | null
  /** 模型を作る処理（Functions）が引き受けた時刻。まだなら null */
  buildStartedAt: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}
