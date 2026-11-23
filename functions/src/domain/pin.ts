// Firestore のデータの型：trips/{tripId}/pins/{pinId}（その下の model/current は domain/model3d.ts）
// 画面側の同じ型は web/src/entities/pin/model/types.ts。片方を変えたら、同じ PR でもう片方と
// firestore.rules、scripts/smoke.mjs も合わせる（docs/architecture/design-principles.md の仮の決め）。
// 誰が書けるか：Functions だけ（AI の結果を改ざんさせない）
import type { PinEvent } from './event'
import type { TimestampLike } from './timestamp'

/** 候補 → 工事中 → 完成（失敗したら failed） */
export type PinStatus = 'candidate' | 'building' | 'done' | 'failed'

/**
 * 場所の種類。地図のピンの絵と、建てる模型の部品を選ぶのに使う。
 * onsen：温泉。ski：スキー場。food：食べもの。farm：農園・牧場。nightview：夜景・展望。
 * nature：自然。shrine：神社・寺・城。themepark：遊ぶところ。town：街歩き（どれでもないときもこれ）。
 * lodging：宿（旅館、ホテルなど）。建つと、しおりの泊まる夜の宿になる（domain/routePlan.ts の assignLodging）。
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
  'lodging',
] as const
export type PinCategory = (typeof PIN_CATEGORIES)[number]

export function isPinCategory(value: unknown): value is PinCategory {
  return typeof value === 'string' && (PIN_CATEGORIES as readonly string[]).includes(value)
}

export interface LatLng {
  lat: number
  lng: number
}

/** しおりの空いた時間への提案の印（Pin.filler） */
export interface PinFiller {
  /** 何日目の空きへの提案か（1 日目が 1） */
  day: number
  /** 「無視」を押した。地図としおりから消し、同じ場所を二度と提案しない */
  dismissed?: true
}

/** 空いた時間への提案の候補の wishId（希望から立ったピンではない印） */
export const FILLER_WISH_ID = '@filler'

/** 提案の候補のうち、まだ「無視」も建築もされていないもの */
export function isOpenFiller(pin: Pick<Pin, 'filler' | 'status'>): boolean {
  return pin.filler !== undefined && !pin.filler.dismissed && pin.status === 'candidate'
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
  suggestedBy: 'stub' | 'agy' | 'vertex'
  /**
   * しおりの何日目の夜の宿として探したか（「宿を探す」を押した夜。希望の lodgingNight を写す）。
   * 宿の候補にだけある。建つと、この夜が空いていればこの夜の宿になる
   */
  lodgingNight?: number
  /**
   * しおりのどの日のどのごはんとして探したか（「1-lunch」。「お店を探す」を押した枠。希望の mealSlot を写す。domain/meal.ts）。
   * ごはんの候補にだけある。建つと、その日のそのごはんの位置に入る（domain/meal.ts の assignMeal）
   */
  mealSlot?: string
  /**
   * しおりの空いた時間への提案（features/suggest-fillers が立てる）にだけある。候補のあいだは全員の地図に色を変えて出し、
   * しおりのその日の「ゆとり」の下に薄い字で出す（企画書、#520）。建てると、ふつうの建物になる。
   * 提案の候補の wishId は FILLER_WISH_ID、uid は空（建てたときに、建てた人のやりたいことになる。features/request-build）
   */
  filler?: PinFiller
  /**
   * 時刻が決まったイベント（花火大会、見学会）の開催の情報。イベントの候補のピンにだけある（features/suggest-places。#581）。
   * しおりでは、着く時刻と出る時刻を固定し、開催日の日に置く。人は時刻を直せず、行をドラッグで動かせない
   */
  event?: PinEvent
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

/**
 * しおりを組む計算（domain/routePlan.ts の PlanPlace）に渡す、宿の印。宿（種類が lodging）のときだけ lodging を付け、
 * 「宿を探す」を押した夜（lodgingNight）があれば want に入れる。宿でなければ空
 */
export function lodgingOf(pin: Pick<Pin, 'category' | 'lodgingNight'>): { lodging?: { want: number | null } } {
  if (pin.category !== 'lodging') return {}
  const night = pin.lodgingNight
  return { lodging: { want: typeof night === 'number' && Number.isInteger(night) && night >= 1 ? night : null } }
}

// ---- 建築の決まり（旅行ごとに建築は 20 棟まで） ----

export const BUILD_LIMIT_PER_TRIP = 20

/** 上限に数える状態（工事中と完成）。失敗したものは数えない */
export const BUILT_STATUSES: PinStatus[] = ['building', 'done']

/** 「建築する！」を受けられる状態。候補と、失敗したもの（もう一度建てられる） */
export function canRequestBuild(status: PinStatus): boolean {
  return status === 'candidate' || status === 'failed'
}

/**
 * 「工事中」のまま止まったとみなすまでの時間。建築のトリガー（features/build-model）の上限 540 秒より長くする。
 * web の entities/pin/model/pins.ts の BUILD_STALE_MS と同じ値にする
 */
export const BUILD_STALE_MS = 600_000

/**
 * 工事中のまま止まったピンか（#727）。関数の時間切れや強制終了では「失敗」が書かれないので、
 * 引き受けた時刻（まだ引き受けていなければ最後に書いた時刻）から BUILD_STALE_MS たった工事中を、失敗したものとして扱う
 */
export function isStaleBuild(pin: Pick<Pin, 'status' | 'buildStartedAt' | 'updatedAt'>, nowMs: number): boolean {
  if (pin.status !== 'building') return false
  const since = pin.buildStartedAt ?? pin.updatedAt
  const sinceMs = since && typeof since.toMillis === 'function' ? since.toMillis() : null
  return sinceMs !== null && nowMs - sinceMs > BUILD_STALE_MS
}

/** Places に聞く文。名前に、Gemini（か見本の一覧）が書いた地域を添える（例：「白骨温泉 長野県松本市」） */
export function placeQuery(pin: Pick<Pin, 'name' | 'area'>): string {
  return [pin.name, pin.area].map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean).join(' ')
}
