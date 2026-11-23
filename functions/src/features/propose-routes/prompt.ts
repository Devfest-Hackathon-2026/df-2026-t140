import type { GeminiTask } from '../../ports/gemini'
import { parseOptions, parseRanking, stubOptions } from './logic'
import type { ProposeRoutesInput, ProposeRoutesOutput, RankPlacesInput, RankPlacesOutput } from './types'

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
      'catchphraseEn は同じ意味の短い英語にしてください（80 文字以内）。',
      '次の形の JSON だけを返してください。',
      '{"options": [{"style": "shortest", "catchphrase": "…", "catchphraseEn": "…", "pinIds": ["id", "id", "id"]}, {"style": "relaxed", …}, {"style": "wishes", …}]}',
    ].join('\n'),
  parse: parseOptions,
  stub: stubOptions,
}

/**
 * 残したい順を付ける仕事（Gemini Flash）。旅が楽しくなること（種類の釣り合い、移動が長すぎないこと）を第一にする
 * （Lazyturtle0852 の決定、2026-11-22、#622）。
 * 呼ぶのは、しおりが時間に収まらないときだけ。費用の関所は、ルート案と同じ（usecase の routesPermit）
 */
export const rankPlacesTask: GeminiTask<RankPlacesInput, RankPlacesOutput> = {
  name: 'rank-places',
  model: 'flash',
  prompt: (input) =>
    [
      '友人グループの旅行で、建てた場所が日程に入りきりません。旅が楽しくなるように、場所に「残したい順」を付けてください。',
      `旅の名前：${JSON.stringify(input.tripTitle)}（${input.days} 日間、出発地：${JSON.stringify(input.originName)}）`,
      `今のままだと、1 日の予定が合計 ${Math.round((input.overMinutes / 60) * 10) / 10} 時間ほど 19 時を越えます。順位の低い場所から、収まるまで予定から外します。`,
      '場所（id、名前、種類、いる時間（分）、希望を書いた人、まとまり、ほかのまとまりから行く片道（分））：',
      ...input.places.map((place) => JSON.stringify(place)),
      '順位の付け方：',
      '- 旅の楽しさを第一にする。種類が偏らず、見どころとくつろぐ場所の釣り合いが取れる組み合わせを上にする',
      '- 移動が長すぎる旅は楽しくない。reach が大きい場所（行くだけで半日かかる場所）は下にする',
      '- 同じ group の場所は、まとめて残すか、まとめて下げる。遠いまとまりの場所を 1 つだけ残すと、移動だけかかって楽しめない',
      '- 似た場所が重なっていれば、片方を下げる',
      '- 同じくらいなら、希望が少ない人の場所を上にする',
      '- 時間の計算はこちらで行う。外す数は決めず、すべての場所に 1 回ずつ順位を付ける',
      '次の形の JSON だけを返してください。',
      '{"ranking": ["いちばん残したい id", "…", "いちばん外してよい id"]}',
    ].join('\n'),
  parse: parseRanking,
  stub: () => ({ ranking: [] }),
}
