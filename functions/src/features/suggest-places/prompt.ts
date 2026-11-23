import type { MealKind } from '../../domain/meal'
import { PIN_CATEGORIES } from '../../domain/pin'
import { REGION_IDS, REGION_NAMES, REGION_PREFECTURES } from '../../domain/region'
import type { GeminiTask } from '../../ports/gemini'
import { LODGING_POOL, MAX_CANDIDATES, parseSuggestOutput, searchCatalogue, searchLodgings, searchMeals } from './logic'
import { clockText, RYOKAN_ARRIVE_BY } from './logic/lodgingPlan'
import { CATALOGUE } from './logic/catalogue'
import type { LodgingPromptContext, SuggestInput, SuggestOutput } from './types'

/** プロンプトでの、朝・昼・晩ごはんの呼び方 */
const MEAL_WORDS: Record<MealKind, string> = { breakfast: '朝ごはん', lunch: '昼ごはん', dinner: '晩ごはん' }

/** 「甲信越（新潟県、山梨県、長野県）、石川県」。地方を丸ごと選んでいれば地方の名前と県、絞っていれば県だけ */
function placesText(input: SuggestInput): string {
  const allowed = input.prefectures ?? []
  return REGION_IDS.flatMap((id) => {
    const inside = REGION_PREFECTURES[id]
    const chosen = inside.filter((name) => allowed.includes(name))
    if (chosen.length === 0) return []
    return chosen.length === inside.length ? [`${REGION_NAMES[id]}（${inside.join('、')}）`] : chosen
  }).join('、')
}

function boundsText(input: SuggestInput): string {
  const bounds = input.bounds
  if (!bounds) return '日本全体'
  return `北緯 ${bounds.south.toFixed(2)}〜${bounds.north.toFixed(2)}、東経 ${bounds.west.toFixed(2)}〜${bounds.east.toFixed(2)} のあたり`
}

const MODE_NAMES: Record<NonNullable<LodgingPromptContext['moveMode']>, string> = { transit: '電車・バス', car: '車', walk: '徒歩', plane: '飛行機' }

/**
 * 宿さがしの頼み方。しおりの様子があれば、その夜の最後の場所と出る時刻、翌日の場所、移動の手段、泊まる側、着く時刻の上限を添える
 * （Takana の決定、todo/humans/2026-11-22-lodging-search-realistic.md）
 */
function lodgingText(context: LodgingPromptContext | undefined): string {
  const kinds = [
    'これは、泊まる宿をさがす希望です。泊まれる場所（旅館、ホテル、ゲストハウス、貸別荘など）だけを出し、category は lodging にしてください。',
    `lodgingKind は、夕食付きの旅館なら ryokan、それ以外（ホテル、ゲストハウス、貸別荘、素泊まりの宿）なら hotel にしてください。`,
    'やりたいことに宿の名前が書かれていたら、その宿を 1 件目にしてください。',
  ]
  if (!context) {
    return [
      ...kinds,
      '探す範囲は、その日の最後に訪れる場所と、翌日の最初に訪れる場所を結んだあたりです。できるだけ、その 2 つのあいだ（探す範囲の真ん中の近く）にある宿を、真ん中に近い順に出してください。',
    ].join('\n')
  }
  const move = context.moveMode ? MODE_NAMES[context.moveMode] : null
  const where =
    context.side === 'route'
      ? `その日の最後の場所「${context.fromName}」から、翌日の最初の場所「${context.nextName}」へ車で向かう道の途中なら、どこでもかまいません。どちらかの場所の近くに寄せず、${context.hotelBy} までに着ける所のうち、道の途中のいろいろな場所の宿を出してください。`
      : context.side === 'between'
        ? `その日の最後の場所「${context.fromName}」から、翌日の最初の場所「${context.nextName}」へ向かう道の途中で、寄り道の少ない宿を出してください。`
        : context.side === 'move'
          ? `「${context.fromName}」から「${context.nextName}」へは${move}で移ります。移動の途中には泊まらず、その夜のうちに移って、「${context.nextName}」の近くの宿を出してください。`
          : context.nextName
            ? `「${context.fromName}」から「${context.nextName}」へは${move}で移りますが、移るのは翌朝です。移動の途中や「${context.nextName}」の近くではなく、「${context.fromName}」の近くの宿を出してください。`
            : `その日の最後の場所「${context.fromName}」の近くの宿を出してください。`
  return [
    ...kinds,
    `${context.night} 日目の夜の宿です。その日は「${context.fromName}」を ${context.leaveAt} ごろに出ます。旅の移動は${MODE_NAMES[context.tripMode]}です${context.tripMode === 'car' ? '（駐車場のある宿にしてください）' : '（駅から歩ける宿にしてください）'}。`,
    where,
    `夕食付きの旅館は ${clockText(RYOKAN_ARRIVE_BY)}、ホテルは ${context.hotelBy} までに着ける宿だけを出してください。`,
  ].join('\n')
}

/**
 * 模型が用意してある場所（見本の場所の一覧。建物辞書 build-model/logic/prebuilt.ts に同じ名前・地域・種類で入っている）。
 * Gemini がこの中の場所を提案するときに同じ書き方で返すと、建てるときに辞書の模型がすぐ出る（辞書は名前・地域・種類の完全一致で引く）。
 * 例：「草津温泉」と書いたのに「草津温泉湯畑」「群馬県吾妻郡草津町」で返ると、辞書に当たらず生成になる（2026-11-18、かめ）
 */
const KNOWN_PLACES = CATALOGUE.map((entry) => `${entry.name}｜${entry.pref}${entry.city}｜${entry.category}`).join('\n')

/**
 * 希望から場所の候補を出す仕事。
 * 送るのは利用者の言葉と、地図で映していた範囲の数字と、旅の地方と県の名前と、自分たちで書いた見本の場所の一覧だけ。Maps から取った情報は送らない（規約 3.2.3(c)）。
 * 固定の応答（stub）は本物の Gemini ではなく、自分たちで書いた見本の場所の一覧から選ぶ（logic/catalogue.ts）。
 * 宿さがし（input.lodging）のときは、泊まれる場所だけを、探す範囲の真ん中に近い順に頼む。固定の応答は、宿の名前を出さず、
 * 泊まる所の多いエリアから選ぶ（logic/lodgings.ts）。模型が用意してある場所の一覧は、宿がないので渡さない。
 * ごはんのお店さがし（input.meal）も同じ形で、その時間に食べられるお店だけを頼む。固定の応答は、食べものの場所と街の駅前から選ぶ
 */
export const suggestPlacesTask: GeminiTask<SuggestInput, SuggestOutput> = {
  name: 'suggest-places',
  model: 'flash',
  prompt: (input) =>
    [
      '友人グループの旅行の計画アプリです。メンバーが書いた「やりたいこと」に合う、日本に実在する場所を提案してください。',
      `やりたいこと：${JSON.stringify(input.text)}`,
      `探す範囲：${boundsText(input)}。ただし、やりたいことに地名が書かれていたら、その地名の場所を優先してください。`,
      input.prefectures && input.prefectures.length > 0
        ? `この旅で行く場所：${placesText(input)}。必ずこの中の場所だけを出してください。やりたいことに書かれた地名がこの外なら、その場所は出さないでください。`
        : '',
      input.exclude.length > 0 ? `もう出した場所（出さない）：${input.exclude.join('、')}` : '',
      input.lodging ? lodgingText(input.lodgingContext) : '',
      input.meal
        ? [
            `これは、旅の途中で${MEAL_WORDS[input.meal]}を食べるお店をさがす希望です。${MEAL_WORDS[input.meal]}の時間に開いている、食事のできるお店（食堂、レストラン、カフェなど）だけを出し、category は food にしてください。`,
            '探す範囲は、その日に訪れる場所のまわりです。できるだけ、探す範囲の真ん中に近い順に出してください。',
          ].join('\n')
        : '',
      `候補は ${input.lodging && input.lodgingContext ? LODGING_POOL : MAX_CANDIDATES} 件まで。確信の持てない場所は出さないでください。`,
      '「清水寺に行きたい」「網走監獄」のように特定の施設が1か所指定され、候補にできる場合は、その施設を先頭にして namedMatch を true にしてください。地域名や施設の種類だけの希望、目的の施設が複数ある希望、近くの別の施設や代案では namedMatch を false にしてください。',
      input.lodging || input.meal
        ? ''
        : '次の場所は、アプリに模型が用意してあります（名前｜地域｜種類）。提案する場所がこの中のどれかと同じ場所なら、name、area、category はこの書き方をそのまま使ってください。この一覧から選ぶ必要はありません。',
      input.lodging || input.meal ? '' : KNOWN_PLACES,
      '希望の日本語・英語を同じように理解してください。name、description、area は日本語で返してください。英語版の nameEn は一般的な英語名かローマ字表記、descriptionEn は英語の短い説明、areaEn は英語の市区町村と都道府県を返してください。',
      '次の形の JSON だけを返してください。',
      '{"places": [{"name": "場所の名前", "description": "40 文字までの一言", "area": "都道府県と市町村",',
      ' "nameEn": "English place name", "descriptionEn": "One short sentence in English", "areaEn": "City, prefecture",',
      ` "category": "${PIN_CATEGORIES.join(' | ')} のどれか", "lat": 緯度, "lng": 経度, "namedMatch": true または false${input.lodging ? ', "lodgingKind": "ryokan または hotel"' : ''}}]}`,
    ]
      .filter(Boolean)
      .join('\n'),
  parse: parseSuggestOutput,
  stub: (input) => ({ places: input.meal ? searchMeals(input) : input.lodging ? searchLodgings(input) : searchCatalogue(input) }),
}
