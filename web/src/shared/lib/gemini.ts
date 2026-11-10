// 候補や案を「誰が出したか」の表示。本物の応答でないものを本物のように見せない（企画書、docs/process/setup.md）。
// 値は Functions の GEMINI_PROVIDER と同じ（functions/src/ports/gemini.ts）。

export type GeminiProvider = 'stub' | 'agy' | 'vertex'

/** 本物の Gemini が出したときの名前。stub（見本）なら null */
export function geminiName(provider: GeminiProvider): string | null {
  if (provider === 'agy') return 'Gemini（Flash）'
  if (provider === 'vertex') return 'Gemini'
  return null
}
