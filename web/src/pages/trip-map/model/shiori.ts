import { translate } from '../../../shared/lib/language.ts'
// しおり（S11〜S13）の小さな決め。

/**
 * 場所の情報（S12）に出す断り書き。建物が用意した部品の模型のときだけ（本物の Gemini が作っていないと分かるように）。
 * 場所を誰が出したか・Google マップで確かめたかは出さない（ヨウキンの要望、2026-11-08、#208。場所カード S05 では今までどおり出す）。
 * なければ undefined
 */
export function placeNote(modelSource: string | undefined): string | undefined {
  return modelSource && modelSource !== 'argon' ? translate('建物は用意した部品の模型です', 'This building uses a pre-made model.') : undefined
}

/**
 * 場所の情報（S12）としおりの再生で、建った場所の写真と口コミを何で聞くか。Places で確かめた place_id。
 * なければ 'by-name'（Functions が名前と地域で探す。用意した部品の模型で建った場所は place_id がない。#279）。
 * 手元（Emulator）では Functions が Places を呼ばずに、開発用の見本を返す（#215）
 */
export function placeReviewsAsk(placeId: string | null): string {
  return placeId ?? 'by-name'
}
