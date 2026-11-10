// 模型の JSON の形と、その検査。保存先は trips/{tripId}/pins/{pinId}/model/current。
// 画面側の同じ型と検査は web/src/entities/model3d/（model/types.ts、lib/parseModelJson.ts）。
// 片方を変えたら、同じ PR でもう片方も変える（docs/architecture/design-principles.md の仮の決め）。
//
// 技術構成の決め：Gemini（Argon）は模型をこの JSON で返し、画面の共通の処理が three.js で描く。
// AI が書いたコードは実行しない。JSON は、ここで形と大きさを検査してから保存する。
//
// 模型の決まり
// - 部品（parts）を並べたもの。部品は、決まった形（shape）を、大きさ・位置・回転・色で置く
// - 単位は「模型の単位」。原点は地面の真ん中で、y が上。x は東、z は南（手前）
// - 全体は、幅と奥行きが 12、高さが 16 の箱に収める。画面は、この箱が同じ大きさに見えるように描く
import type { TimestampLike } from './timestamp'

export const MODEL_VERSION = 1

/**
 * 部品の形。どれも、大きさ 1 の箱にちょうど入る形を、size で引きのばして使う。
 * box：直方体。cylinder：円柱（軸は y）。cone：円すい（とがった先が上）。pyramid：四角すい。
 * sphere：球（引きのばすと、だ円の球）。roof：三角の屋根（棟が x の向き）。
 */
export const MODEL_SHAPES = ['box', 'cylinder', 'cone', 'pyramid', 'sphere', 'roof'] as const
export type ModelShape = (typeof MODEL_SHAPES)[number]

export type Vec3 = [number, number, number]

export interface ModelPart {
  shape: ModelShape
  /** 大きさ [幅 x, 高さ y, 奥行き z] */
  size: Vec3
  /** 部品の真ん中の位置 [x, y, z] */
  position: Vec3
  /** 回転（度）[x, y, z]。ないときは回さない */
  rotation?: Vec3
  /** #rrggbb */
  color: string
  /** 透けぐあい。0.2〜1。ないときは 1（透けない） */
  opacity?: number
}

export interface ModelJson {
  version: typeof MODEL_VERSION
  parts: ModelPart[]
}

/** pins/{pinId}/model/current。模型の JSON は表示するときだけ読む。書くのは Functions だけ */
export interface PinModel {
  json: ModelJson
  /** parts：用意した部品。argon：Gemini が作った */
  source: 'parts' | 'argon'
  /**
   * 模型の入力に使った参考の説明（Knowledge Graph の detailedDescription、Wikipedia の冒頭、CC BY-SA）と出典。なければ省く。
   * CC BY-SA は出典を示せば保存と表示を許すので、場所の情報にも出す（かめ、2026-11-08）
   */
  reference?: { text: string; url: string; license: string }
  createdAt: TimestampLike
}

/** 検査の上限。画面が重くならず、Firestore の 1 ドキュメント（1 MiB）に余裕で収まる大きさ */
export const MODEL_LIMITS = {
  maxParts: 80,
  minSize: 0.05,
  maxSize: 14,
  /** x と z は ±7、y は -1〜16 の中 */
  maxOffset: 7,
  minY: -1,
  maxY: 16,
  minOpacity: 0.2,
} as const

function vec3(value: unknown, what: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error(`${what} は数字 3 つの配列にします`)
  }
  return [value[0], value[1], value[2]]
}

/**
 * 模型の JSON が決めた形かを確かめ、決めた項目だけを取り出して返す。違えば例外を投げる。
 * 知らない項目は落とす（JSON はデータとしてだけ扱い、コードとしては決して実行しない）。
 */
export function validateModelJson(json: unknown): ModelJson {
  const model = json as { version?: unknown; parts?: unknown } | null
  if (!model || typeof model !== 'object') throw new Error('模型の JSON がオブジェクトではありません')
  if (model.version !== MODEL_VERSION) throw new Error(`version は ${MODEL_VERSION} にします`)
  if (!Array.isArray(model.parts) || model.parts.length === 0) throw new Error('parts（部品の配列）がありません')
  if (model.parts.length > MODEL_LIMITS.maxParts) throw new Error(`部品は ${MODEL_LIMITS.maxParts} 個までです`)

  const parts = model.parts.map((raw: Record<string, unknown> | null, index): ModelPart => {
    const at = `部品 ${index + 1}`
    if (!raw || typeof raw !== 'object') throw new Error(`${at} がオブジェクトではありません`)
    if (!(MODEL_SHAPES as readonly unknown[]).includes(raw.shape)) throw new Error(`${at} の shape が決めた形ではありません`)
    const size = vec3(raw.size, `${at} の size`)
    if (size.some((value) => value < MODEL_LIMITS.minSize || value > MODEL_LIMITS.maxSize)) {
      throw new Error(`${at} の size は ${MODEL_LIMITS.minSize}〜${MODEL_LIMITS.maxSize} にします`)
    }
    const position = vec3(raw.position, `${at} の position`)
    const [x, y, z] = position
    if (Math.abs(x) > MODEL_LIMITS.maxOffset || Math.abs(z) > MODEL_LIMITS.maxOffset || y < MODEL_LIMITS.minY || y > MODEL_LIMITS.maxY) {
      throw new Error(`${at} の position が、模型の箱の外です`)
    }
    if (typeof raw.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) throw new Error(`${at} の color は #rrggbb にします`)

    const part: ModelPart = { shape: raw.shape as ModelShape, size, position, color: raw.color.toLowerCase() }
    if (raw.rotation !== undefined) {
      const rotation = vec3(raw.rotation, `${at} の rotation`)
      if (rotation.some((value) => Math.abs(value) > 360)) throw new Error(`${at} の rotation は ±360 度までです`)
      part.rotation = rotation
    }
    if (raw.opacity !== undefined) {
      if (typeof raw.opacity !== 'number' || !(raw.opacity >= MODEL_LIMITS.minOpacity && raw.opacity <= 1)) {
        throw new Error(`${at} の opacity は ${MODEL_LIMITS.minOpacity}〜1 にします`)
      }
      part.opacity = raw.opacity
    }
    return part
  })
  return { version: MODEL_VERSION, parts }
}
