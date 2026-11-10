// 模型の JSON の形。保存先は trips/{tripId}/pins/{pinId}/model/current（書くのは Functions だけ）。
// Functions 側の同じ型と検査は functions/src/domain/model3d.ts。片方を変えたら、同じ PR でもう片方も変える
// （docs/architecture/design-principles.md の仮の決め）。
//
// 模型は、部品（parts）を並べたもの。部品は、決まった形を、大きさ・位置・回転・色で置く。
// 原点は地面の真ん中で、y が上。全体は、幅と奥行き 12・高さ 16 の箱に収まる。
// この JSON を lib/buildModelObject.ts が three.js で描く。AI が書いたコードは実行しない。
import type { Timestamp } from 'firebase/firestore'

export const MODEL_VERSION = 1

/**
 * 部品の形。どれも、大きさ 1 の箱にちょうど入る形を、size で引きのばして使う。
 * box：直方体。cylinder：円柱（軸は y）。cone：円すい（先が上）。pyramid：四角すい。
 * sphere：球。roof：三角の屋根（棟が x の向き）。
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
  /** 透けぐあい。0.2〜1。ないときは 1 */
  opacity?: number
}

export interface ModelJson {
  version: typeof MODEL_VERSION
  parts: ModelPart[]
}

/** pins/{pinId}/model/current */
export interface StoredModel {
  /** 画面で使う前に、lib/parseModelJson.ts で検査する */
  json: unknown
  /** parts：用意した部品。argon：Gemini が作った */
  source: 'parts' | 'argon'
  /** 模型の入力に使った参考の説明の出典（Wikipedia の記事と CC BY-SA）。なければない */
  reference?: unknown
  createdAt: Timestamp
}
