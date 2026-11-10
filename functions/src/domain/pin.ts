// Firestore のデータの型：trips/{tripId}/pins/{pinId}（その下の model/current は domain/model3d.ts）
// 画面側の同じ型は web/src/entities/pin/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ（AI の結果を改ざんさせない）
import type { TimestampLike } from './timestamp'

/** 候補 → 工事中 → 完成（失敗したら failed） */
export type PinStatus = 'candidate' | 'building' | 'done' | 'failed'

/**
 * 場所の種類。地図のピンの絵と、建てる模型の部品を選ぶのに使う。
 * onsen：温泉。ski：スキー場。food：食べもの。farm：農園・牧場。nightview：夜景・展望。
 * nature：自然。shrine：神社・寺・城。themepark：遊ぶところ。town：街歩き（どれでもないときもこれ）。
 */
export const PIN_CATEGORIES = [
  'onsen',
  'ski',
  'food',
  'farm',
  'nightview',
  'nature',
  'shrine',
  'themepark',
  'town',
] as const
export type PinCategory = (typeof PIN_CATEGORIES)[number]

export function isPinCategory(value: unknown): value is PinCategory {
  return typeof value === 'string' && (PIN_CATEGORIES as readonly string[]).includes(value)
}

export interface LatLng {
  lat: number
  lng: number
}

export interface Pin {
  /** もとになった希望 */
  wishId: string
  /** 希望を書いた人 */
  uid: string
  name: string
  description: string
  /** 「長野県安曇野市」など。Gemini（か見本の一覧）が書いたもの。Maps から取ったものではない */
  area: string
  category: PinCategory
  location: LatLng
  status: PinStatus
  /** 候補を出したもの。stub は見本の場所の一覧（本物の Gemini ではない）。画面でそう分かるようにする */
  suggestedBy: 'stub' | 'agy' | 'vertex'
  /** Places で確かめたときの place_id。店名や住所は表示のときに取り直す */
  placeId: string | null
  /** 「建築する！」を押した人 */
  builtBy: string | null
  /**
   * 模型を作る処理（features/build-model）が引き受けた時刻。まだなら null。
   * 「工事中」で null のピンだけを、トリガーが引き受ける（同じイベントが 2 回来ても、1 回だけ作る）
   */
  buildStartedAt: TimestampLike | null
  createdAt: TimestampLike
  updatedAt: TimestampLike
}

// ---- 建築の決まり（旅行ごとに建築は 20 棟まで） ----

export const BUILD_LIMIT_PER_TRIP = 20

/** 上限に数える状態（工事中と完成）。失敗したものは数えない */
export const BUILT_STATUSES: PinStatus[] = ['building', 'done']

/** 「建築する！」を受けられる状態。候補と、失敗したもの（もう一度建てられる） */
export function canRequestBuild(status: PinStatus): boolean {
  return status === 'candidate' || status === 'failed'
}

/** Places に聞く文。名前に、Gemini（か見本の一覧）が書いた地域を添える（例：「白骨温泉 長野県松本市」） */
export function placeQuery(pin: Pick<Pin, 'name' | 'area'>): string {
  return [pin.name, pin.area].map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean).join(' ')
}
