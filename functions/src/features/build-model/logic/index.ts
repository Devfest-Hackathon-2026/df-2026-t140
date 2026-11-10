import { type ModelJson, validateModelJson } from '../../../domain/model3d'
import type { Pin } from '../../../domain/pin'
import type { GeminiResult } from '../../../ports/gemini'
import { prefabFor } from './prefabs'

// 建築（模型を作る）の純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

export { prefabFor } from './prefabs'

/** トリガーが引き受けるピンか。「工事中」で、まだ誰も引き受けていないもの */
export function shouldStartBuild(pin: Pick<Pin, 'status' | 'buildStartedAt'> | undefined): boolean {
  return pin?.status === 'building' && !pin.buildStartedAt
}

/**
 * Gemini の呼び出し口の結果から、保存する模型を決める。
 * - 固定の応答（部品の模型）なら source は parts。本物の Gemini が作ったものなら argon
 * - 形や大きさが決めたとおりでなければ、その種類の部品の模型に差し替える（企画書「生成の失敗」）
 */
export function chooseModel(
  result: GeminiResult<unknown>,
  category: Pin['category'],
): { json: ModelJson; source: 'parts' | 'argon' } {
  try {
    const json = validateModelJson(result.output)
    return { json, source: result.provider === 'stub' ? 'parts' : 'argon' }
  } catch {
    return { json: prefabFor(category), source: 'parts' }
  }
}
