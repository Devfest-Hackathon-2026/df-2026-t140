// 場所を誰が出したかと、Google マップで場所を確かめたかの断り書き。純粋な関数だけ（scripts/web.test.mjs で確かめる）。
import { translate } from '../../../shared/lib/language.ts'

/** Places で確かめた場所に添える一言（features/verify-place が placeId を書いたとき） */
export const VERIFIED_NOTE = translate('場所は Google マップで確かめました', 'Location verified with Google Maps.')

/**
 * gemini は geminiName(pin.suggestedBy) の値（見本なら null）。verified はピンに placeId があるか。
 * noun は「候補」（地図のカード）か「場所」（しおりの場所の情報）
 */
export function pinOriginNote(gemini: string | null, verified: boolean, noun: '候補' | '場所' = '候補'): string {
  if (gemini) {
    return verified
      ? translate(`${gemini}の提案です。${VERIFIED_NOTE}`, `Suggested by ${gemini}. ${VERIFIED_NOTE}`)
      : translate(`${gemini}の提案です（実在の確認はしていません）`, `Suggested by ${gemini}. Location has not been verified.`)
  }
  const sample = translate(`見本の場所リストから出した${noun}です（AI の提案ではありません）`, 'This place comes from the sample list.')
  return verified ? translate(`${sample}。${VERIFIED_NOTE}`, `${sample} ${VERIFIED_NOTE}`) : sample
}
