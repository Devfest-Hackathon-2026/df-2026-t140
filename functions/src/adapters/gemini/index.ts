import type {
  GeminiPort,
  GeminiProvider,
  GeminiResult,
  GeminiRunOptions,
  GeminiTask,
  GenerateText,
} from '../../ports/gemini'
import { generateWithAgy } from './agy'
import { ProviderConfigError, ProviderUnavailableError } from './errors'
import { generateWithVertex } from './vertex'

// Gemini を呼ぶ入口はここ 1 つ。Functions のほかの場所から Gemini を直接呼ばない。
// 環境変数 GEMINI_PROVIDER で切り替える。何も書かなければ stub（固定の応答）。
//
//   stub    普段の開発、CI、本番の既定。固定の応答（各仕事の stub() が返す）
//   agy     ローカルで本物の Gemini（Flash と Argon）を試す（agy.ts。1 日の回数の上限 AGY_MAX_CALLS と AGY_MAX_ARGON_CALLS 付き）
//   vertex  Cloud の Gemini（vertex.ts）。費用がかかる唯一の経路。Flash（場所の候補、しおりのルート）と Argon（模型）
//
// 【費用】vertex は、usecase が付けた印（GeminiPermit）があるときだけ呼ぶ。印は「頼んだ人が合言葉を通している」と
// 「回数の上限の中」（ports/aiGate.ts、domain/geminiBudget.ts）を確かめたときだけ作る。印がなければ固定の応答に戻す。
// Flash は累計 300 回、Argon は 1 日 20 回・累計 80 回（技術構成の「費用の上限」。design-principles の cost/gemini-guarded）。
// agy は開発者のアカウントのクォータで動き、agy.ts の中で 1 日の回数（既定は Flash 30、Argon 20）を数えて止める。
// 本番で vertex にするかどうかは人が決める（todo/humans/2026-11-07-vertex-gemini-passphrase.md、
// ルートと模型は todo/humans/2026-11-07-vertex-routes-model.md）。AI は設定しない。

const PROVIDERS: readonly GeminiProvider[] = ['stub', 'agy', 'vertex']

const generators: Record<Exclude<GeminiProvider, 'stub'>, GenerateText> = {
  agy: generateWithAgy,
  vertex: generateWithVertex,
}

/** 応答の形が違ったときにやり直す回数 */
const RETRIES = 1

export function currentProvider(): GeminiProvider {
  const value = process.env.GEMINI_PROVIDER
  if (!value) return 'stub'
  if ((PROVIDERS as readonly string[]).includes(value)) return value as GeminiProvider
  console.warn(`GEMINI_PROVIDER=${value} は使えない値なので、stub にします`)
  return 'stub'
}

/** 費用のかかる経路か。印（GeminiPermit）がなければ呼ばない */
export function needsPermit(provider: GeminiProvider): boolean {
  return provider === 'vertex'
}

/**
 * 応答の文から JSON を取り出す。```json で囲まれていても、前後に一言が付いていても読む。
 * 本物のモデルは「以下が JSON です」のような前置きを付けることがあるので、最初の { か [ から最後の } か ] までを試す。
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  try {
    return JSON.parse(body)
  } catch (cause) {
    const starts = [body.indexOf('{'), body.indexOf('[')].filter((index) => index >= 0)
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
    if (starts.length === 0 || end < 0) throw cause
    return JSON.parse(body.slice(Math.min(...starts), end + 1))
  }
}

export interface RunOptions extends GeminiRunOptions {
  /** テスト用。本物の代わりに使う処理 */
  generate?: GenerateText
}

export async function runGemini<Input, Output>(
  task: GeminiTask<Input, Output>,
  input: Input,
  options: RunOptions = {},
): Promise<GeminiResult<Output>> {
  const provider = currentProvider()
  if (provider === 'stub') {
    return { output: task.stub(input), provider: 'stub', fellBack: false }
  }
  if (needsPermit(provider) && !options.permit) {
    console.warn(`Gemini（${provider}、${task.name}）は、印（合言葉と回数の上限）がないので固定の応答にします`)
    return { output: task.stub(input), provider: 'stub', fellBack: true }
  }

  const generate = options.generate ?? generators[provider]
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const text = await generate(task.model, task.prompt(input))
      return { output: task.parse(extractJson(text)), provider, fellBack: false }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      console.warn(`Gemini（${provider}、${task.name}）の ${attempt + 1} 回目が失敗しました：${reason}`)
      // 1 回目から設定の誤りなら、相手の側では何も作っていないので数えた 1 回を戻す。
      // 2 回目なら 1 回目は呼べているので戻さない
      if (cause instanceof ProviderConfigError && attempt === 0) await refundPermit(options.permit)
      if (cause instanceof ProviderUnavailableError) break
    }
  }

  // 本物が使えない、または応答の形が 2 回とも違った。流れを止めないよう固定の応答に戻す
  return { output: task.stub(input), provider: 'stub', fellBack: true }
}

/** 印の refund を呼ぶ。戻せなくても流れは止めない（数え過ぎは費用側なので許す） */
async function refundPermit(permit: GeminiRunOptions['permit']): Promise<void> {
  if (!permit?.refund) return
  try {
    await permit.refund()
  } catch (cause) {
    console.warn('数えた回数を戻せませんでした', cause)
  }
}

/** 各機能の handler が logic に渡す、Gemini の呼び出し口 */
export const gemini: GeminiPort = { run: (task, input, options) => runGemini(task, input, options) }
