import { GoogleGenAI } from '@google/genai'
import type { GeminiModel, GenerateText } from '../../ports/gemini'
import { isVertexConfigFailure } from '../../domain/geminiBudget'
import { ProviderConfigError, ProviderUnavailableError } from './errors'

// GEMINI_PROVIDER=vertex：Cloud の Gemini（Vertex AI）。費用がかかる唯一の経路。
//
// - 呼び出し口（index.ts）は、usecase が付けた印（GeminiPermit：合言葉と回数の上限を通した）がなければ
//   ここを呼ばず固定の応答に戻す。ここは文を返すだけで、上限は見ない
// - Flash（場所の候補、しおりのルート）と Argon（模型）。上限は Flash 累計 300 回、Argon 1 日 20 回・累計 300 回
//   （domain/geminiBudget.ts。決定は todo/humans/2026-11-07-vertex-routes-model.md）
// - Argon は応答が長いので、1 回の待ち時間を ARGON_TIMEOUT_MS で切る。呼び出し口が 1 回やり直すので、
//   2 回分が建築のトリガーの打ち切り時間（features/build-model/handler.ts の 540 秒）に収まる長さにする
// - 最新のモデルは location が global でのみ提供（技術構成。2026-11-05 に確認）
// - モデルの名前は VERTEX_FLASH_MODEL と VERTEX_ARGON_MODEL で変えられる。Argon の既定の名前は未確認（agy では gemini-4-argon-medium）。名前が違って 404 になっても、固定の応答に戻るだけで費用は出ない（数えた 1 回も戻す。401、403 も同じ）
// - クライアントは最初に使うときに作る（design-principles の fn/lazy-init）
// - 本番の有効化は人が行う（Deploy ワークフローの variable）。AI は有効にしない

const DEFAULT_FLASH_MODEL = 'gemini-3.8-flash'
const DEFAULT_ARGON_MODEL = 'gemini-4-argon'
/** Argon 1 回の待ち時間の上限。2 回分（510 秒）と固定の応答の待ち時間が、建築のトリガーの 540 秒に収まる */
export const ARGON_TIMEOUT_MS = 255_000
const LOCATION = 'global'

let client: GoogleGenAI | undefined

function vertexClient(): GoogleGenAI {
  if (client) return client
  const project = process.env.GCLOUD_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim()
  if (!project) throw new ProviderUnavailableError('Vertex AI のプロジェクトが分かりません（GCLOUD_PROJECT）')
  client = new GoogleGenAI({ vertexai: true, project, location: LOCATION })
  return client
}

/**
 * SDK の失敗のうち、やり直しても無駄なもの（設定の誤り、権限、割り当て）は「使えない」にする。
 * そのうち設定の誤り（401、403、404）は ProviderConfigError にし、数えた 1 回を戻せるようにする
 */
export function classify(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause)
  const status = (cause as { status?: unknown } | null)?.status
  if (isVertexConfigFailure(status)) {
    return new ProviderConfigError(`Vertex AI が ${status} を返しました（設定の誤り）：${message}`)
  }
  if (typeof status === 'number' && [400, 429].includes(status)) {
    return new ProviderUnavailableError(`Vertex AI が ${status} を返しました：${message}`)
  }
  return cause instanceof Error ? cause : new Error(message)
}

/** 使うモデルの名前 */
export function vertexModelName(model: GeminiModel): string {
  if (model === 'argon') return process.env.VERTEX_ARGON_MODEL?.trim() || DEFAULT_ARGON_MODEL
  return process.env.VERTEX_FLASH_MODEL?.trim() || DEFAULT_FLASH_MODEL
}

export const generateWithVertex: GenerateText = async (model, prompt) => {
  const name = vertexModelName(model)
  const startedAt = Date.now()
  try {
    const response = await vertexClient().models.generateContent({
      model: name,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        ...(model === 'argon' ? { httpOptions: { timeout: ARGON_TIMEOUT_MS } } : {}),
      },
    })
    const text = response.text ?? ''
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.info(`Vertex（${name}）を呼びました：${seconds} 秒、応答 ${text.length} 文字`)
    if (!text) throw new Error('Vertex の応答が空でした')
    return text
  } catch (cause) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.warn(`Vertex（${name}）が失敗しました：${seconds} 秒`)
    throw classify(cause)
  }
}
