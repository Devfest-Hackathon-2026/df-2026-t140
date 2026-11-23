import type { GeminiTask } from '../../ports/gemini'
import { nightsOf, parseTitleOutput, placeNames, stubTitle, TITLE_MAX, TITLE_MAX_EN } from './logic'
import type { SuggestTitleInput, SuggestTitleOutput } from './types'

/**
 * 旅の名前を考える仕事。送るのは、日程、出発地の名前、乗り物、選んだ地方と県の名前だけ（利用者が入れたものと、アプリの中の表）。
 * Maps から取った情報は送らない（規約 3.2.3(c)）。固定の応答は、季節と行き先から作る名前（logic.ts の stubTitle）
 */
export const suggestTitleTask: GeminiTask<SuggestTitleInput, SuggestTitleOutput> = {
  name: 'suggest-title',
  model: 'flash',
  prompt: (input) =>
    [
      '友人グループの旅行の計画アプリです。これから作る旅に、短くて楽しい名前を 1 つ付けてください。',
      `日程：${input.startDate}${input.endDate ? ` から ${input.endDate}` : ''}（${nightsOf(input) === 0 ? '日帰り' : `${nightsOf(input)}泊${nightsOf(input) + 1}日`}）`,
      `出発地：${JSON.stringify(input.origin)}`,
      `おもな移動：${input.travelMode === 'car' ? '車' : input.travelMode === 'plane' ? '飛行機' : '電車・バス'}`,
      `行き先：${placeNames(input.prefectures).join('、')}`,
      `名前は ${input.language === 'en' ? `${TITLE_MAX_EN} 文字（空白も数える）` : `${TITLE_MAX} 文字`}まで。画面の帯に 1 行で収まるよう、短く言い切る。季節や行き先の名物を入れてよい。絵文字と記号は使わない。行き先にない地名は入れない。`,
      input.language === 'en' ? '名前は英語にしてください。地名は一般的な英語名かローマ字表記を使ってください。' : '名前は日本語にしてください。',
      '次の形の JSON だけを返してください。',
      '{"title": "旅の名前"}',
    ].join('\n'),
  parse: parseTitleOutput,
  stub: stubTitle,
}
