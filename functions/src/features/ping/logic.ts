import type { GeminiProvider, GeminiTask } from '../../ports/gemini'
import type { PingPorts } from './ports'

// SDK を import しない純粋な処理。ports を差し替えれば単体で試せる（scripts/functions.test.mjs）。

export interface PingOutput {
  text: string
}

export interface PingResponse {
  text: string
  provider: GeminiProvider
  fellBack: boolean
}

// 接続確認用。費用を抑えるため、利用者の入力は受け取らず固定の文だけを送る。
// 新しい仕事（場所の提案、ルート案、模型など）は、同じ形で各機能の logic.ts か prompt.ts に書く。
export const pingTask: GeminiTask<void, PingOutput> = {
  name: 'ping',
  model: 'flash',
  prompt: () =>
    '友人との旅行の計画が楽しみになる一言を、日本語 20 文字以内で書いてください。' +
    '{"text": "一言"} の形の JSON だけを返してください。',
  parse(json) {
    const text = (json as { text?: unknown } | null)?.text
    if (typeof text !== 'string' || text.length === 0) throw new Error('text がありません')
    return { text }
  },
  stub: () => ({ text: '（固定の応答）みんなで旅を建てよう' }),
}

export async function ping(ports: PingPorts): Promise<PingResponse> {
  const { output, provider, fellBack } = await ports.gemini.run(pingTask, undefined)
  return { text: output.text, provider, fellBack }
}
