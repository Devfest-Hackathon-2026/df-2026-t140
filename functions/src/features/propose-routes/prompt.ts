import type { GeminiTask } from '../../ports/gemini'
import { parseOptions, stubOptions } from './logic'
import type { ProposeRoutesInput, ProposeRoutesOutput } from './types'

/**
 * ルート案を 3 つ考える仕事（Gemini Flash）。
 *
 * - 返してもらうのは、回る順番とキャッチコピーだけ。時刻と移動時間は、Functions が順番から計算する
 *   （domain/routePlan.ts。直線距離からの見積もり）。Maps の Routes は使わない
 * - 送るのは、建った場所の名前、種類、およその位置、誰の希望か、旅の日数、出発地の名前だけ
 * - 固定の応答（stub）は、自分たちの計算（移動が短い順、その逆まわり、全員の希望が早めに入る順）。
 *   本物の Gemini は、手元では agy（adapters/gemini/agy.ts。1 日の回数の上限付き）でつながる。Cloud（vertex）は、
 *   つなぐ前に回数の上限（Flash は累計 300 回）を usecase に入れる
 */
export const proposeRoutesTask: GeminiTask<ProposeRoutesInput, ProposeRoutesOutput> = {
  name: 'propose-routes',
  model: 'flash',
  prompt: (input) =>
    [
      '友人グループの旅行で、建てた場所を回るルート案を 3 つ考えます。',
      `旅の名前：${JSON.stringify(input.tripTitle)}（${input.days} 日間、出発地：${JSON.stringify(input.origin.name)}）`,
      '回る場所（id、名前、種類、緯度、経度、希望を書いた人）：',
      ...input.places.map((place) =>
        JSON.stringify({ id: place.id, name: place.name, category: place.category, lat: place.location.lat, lng: place.location.lng, wisher: place.uid }),
      ),
      '3 つの案は、style を 1 つずつ使ってください。',
      '- shortest：移動がいちばん短くなる順',
      '- relaxed：1 か所に長くいる、ゆったりした順',
      '- wishes：全員の希望が、早いうちに 1 つずつ入る順',
      'どの案も、すべての場所を 1 回ずつ回ります。3 つの案の順番は、互いに違うものにしてください。',
      'catchphrase は、その案の旅を一言で表す、40 文字までの日本語にしてください。',
      '次の形の JSON だけを返してください。',
      '{"options": [{"style": "shortest", "catchphrase": "…", "pinIds": ["id", "id", "id"]}, {"style": "relaxed", …}, {"style": "wishes", …}]}',
    ].join('\n'),
  parse: parseOptions,
  stub: stubOptions,
}
