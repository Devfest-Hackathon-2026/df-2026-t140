import { MODEL_LIMITS, MODEL_SHAPES, type ModelJson, validateModelJson } from '../../domain/model3d'
import type { GeminiTask } from '../../ports/gemini'
import { prefabFor } from './logic'
import type { BuildModelInput } from './types'

/**
 * 模型の JSON を作る仕事（Gemini 4 Argon）。
 *
 * - 返してもらうのは JSON だけ。画面の共通の処理（web/src/entities/model3d）が three.js で描く。
 *   AI が書いたコードは実行しない（技術構成）
 * - 送るのは、場所の名前、一言の説明、利用者の希望の文だけ。Maps 由来の内容は送らない（規約 3.2.3(c)）
 * - 固定の応答（stub）は、場所の種類に合う部品の模型（logic/prefabs.ts）。本物の Argon は、手元の agy でだけつないである
 *   （1 日 20 回の上限は adapters/gemini/agy.ts。超えたら部品の模型）。Cloud（vertex）でつなぐときは、累計 80 回の上限も要る
 */
export const buildModelTask: GeminiTask<BuildModelInput, ModelJson> = {
  name: 'build-model',
  model: 'argon',
  prompt: (input) =>
    [
      '旅行の計画アプリで、地図の上に置く小さな 3D の模型（ローポリのジオラマ）を作ります。',
      `場所の名前：${JSON.stringify(input.name)}`,
      `説明：${JSON.stringify(input.description)}`,
      input.wishText ? `この場所を選んだ人のやりたいこと：${JSON.stringify(input.wishText)}` : '',
      input.reference ? `参考（この名前の百科事典の説明。見た目の手がかりにする）：${JSON.stringify(input.reference)}` : '',
      '実在の建物を正確に再現する必要はありません。その場所らしさが一目で伝わる形にしてください。',
      '次の形の JSON だけを返してください。コードは書かないでください。',
      '{"version": 1, "parts": [{"shape": "box", "size": [幅, 高さ, 奥行き], "position": [x, y, z], "rotation": [x, y, z], "color": "#rrggbb", "opacity": 1}]}',
      `- shape は ${MODEL_SHAPES.join('、')} のどれか。どれも大きさ 1 の箱に入る形を size で引きのばす。cylinder の軸は y、cone と pyramid は先が上、roof は棟が x の向きの三角屋根`,
      '- 原点は地面の真ん中。y が上。position は部品の真ん中。rotation は度（省略できる）。opacity は 0.2〜1（省略できる）',
      `- 全体は、x と z が ±${MODEL_LIMITS.maxOffset}、y が 0〜${MODEL_LIMITS.maxY} の中に収める。最初の部品は、幅と奥行き 10、高さ 0.6 の土台の板にする`,
      `- 部品は ${MODEL_LIMITS.maxParts} 個まで。size は ${MODEL_LIMITS.minSize}〜${MODEL_LIMITS.maxSize}`,
    ]
      .filter(Boolean)
      .join('\n'),
  parse: validateModelJson,
  stub: (input) => prefabFor(input.category),
}
