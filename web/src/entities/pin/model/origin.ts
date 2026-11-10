// 場所を誰が出したかと、Google マップで場所を確かめたかの断り書き。純粋な関数だけ（scripts/web.test.mjs で確かめる）。

/** Places で確かめた場所に添える一言（features/verify-place が placeId を書いたとき） */
export const VERIFIED_NOTE = '場所は Google マップで確かめました'

/**
 * gemini は geminiName(pin.suggestedBy) の値（見本なら null）。verified はピンに placeId があるか。
 * noun は「候補」（地図のカード）か「場所」（しおりの場所の情報）
 */
export function pinOriginNote(gemini: string | null, verified: boolean, noun: '候補' | '場所' = '候補'): string {
  if (gemini) return verified ? `${gemini}の提案です。${VERIFIED_NOTE}` : `${gemini}の提案です（実在の確認はしていません）`
  const sample = `見本の場所リストから出した${noun}です（AI の提案ではありません）`
  return verified ? `${sample}。${VERIFIED_NOTE}` : sample
}
