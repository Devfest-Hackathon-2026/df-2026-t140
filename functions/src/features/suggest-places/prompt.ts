import { PIN_CATEGORIES } from '../../domain/pin'
import type { GeminiTask } from '../../ports/gemini'
import { MAX_CANDIDATES, parseSuggestOutput, searchCatalogue } from './logic'
import type { SuggestInput, SuggestOutput } from './types'

function boundsText(input: SuggestInput): string {
  const bounds = input.bounds
  if (!bounds) return '日本全体'
  return `北緯 ${bounds.south.toFixed(2)}〜${bounds.north.toFixed(2)}、東経 ${bounds.west.toFixed(2)}〜${bounds.east.toFixed(2)} のあたり`
}

/**
 * 希望から場所の候補を出す仕事。
 * 送るのは利用者の言葉と、地図で映していた範囲の数字だけ。Maps から取った情報は送らない（規約 3.2.3(c)）。
 * 固定の応答（stub）は本物の Gemini ではなく、自分たちで書いた見本の場所の一覧から選ぶ（logic/catalogue.ts）。
 */
export const suggestPlacesTask: GeminiTask<SuggestInput, SuggestOutput> = {
  name: 'suggest-places',
  model: 'flash',
  prompt: (input) =>
    [
      '友人グループの旅行の計画アプリです。メンバーが書いた「やりたいこと」に合う、日本に実在する場所を提案してください。',
      `やりたいこと：${JSON.stringify(input.text)}`,
      `探す範囲：${boundsText(input)}。ただし、やりたいことに地名が書かれていたら、その地名の場所を優先してください。`,
      input.exclude.length > 0 ? `もう出した場所（出さない）：${input.exclude.join('、')}` : '',
      `候補は ${MAX_CANDIDATES} 件まで。確信の持てない場所は出さないでください。`,
      '次の形の JSON だけを返してください。',
      '{"places": [{"name": "場所の名前", "description": "40 文字までの一言", "area": "都道府県と市町村",',
      ` "category": "${PIN_CATEGORIES.join(' | ')} のどれか", "lat": 緯度, "lng": 経度}]}`,
    ]
      .filter(Boolean)
      .join('\n'),
  parse: parseSuggestOutput,
  stub: (input) => ({ places: searchCatalogue(input) }),
}
