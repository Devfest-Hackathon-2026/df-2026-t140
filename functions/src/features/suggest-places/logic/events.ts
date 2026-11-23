import { datesOf, type EventKind, type PinEvent, weekdayOf } from '../../../domain/event'
import type { PinCategory } from '../../../domain/pin'
import type { MapBounds } from '../../../domain/wish'
import type { SuggestedPlace } from '../types'
import { MAX_CANDIDATES } from './index'

// 時刻が決まったイベント（花火大会、見学会）を探す（#581。企画書の合意前の案「時刻が決まったイベント（2026-11-21）」）。
//
// - 開催日や時刻を Gemini に作らせない（もっともらしい日付を作ってしまうため）。本物の Gemini（agy、vertex）のときも、この一覧から探す
// - 本物の情報源（Google 検索で裏付ける Gemini など）は料金がかかるので、人が決める（todo/humans/2026-11-21-event-source.md）。
//   決まるまでは、この見本の一覧だけを使う。名前に「見本」と入れ、実在の大会や見学会のふりをしない（動いていない機能を、動いているように見せない）
// - 開催は曜日で決める（花火は土曜の夜、見学会は平日の朝）。旅の日程にその曜日がなければ、見つからない
// - 街の位置は、このリポジトリで書いたおよその値（Maps から取ったものではない）

/** 見本の一覧の出典の名前（Pin.event.source） */
export const EVENT_SOURCE = '見本のイベントの一覧（実在の催しではありません）'

interface EventRule {
  kind: EventKind
  /** 開催する曜日（0 が日曜） */
  weekdays: number[]
  start: number
  end: number
  leadMinutes: number
  category: PinCategory
  /** 名前（「見本の花火大会（諏訪）」の「花火大会」） */
  label: string
  description: string
}

const RULES: Record<EventKind, EventRule> = {
  fireworks: {
    kind: 'fireworks',
    weekdays: [6],
    start: 19 * 60 + 30,
    end: 20 * 60 + 30,
    leadMinutes: 60,
    category: 'nightview',
    label: '花火大会',
    description: '土曜の夜の花火大会の見本です。始まる 1 時間前に着いて、見る場所を取ります。',
  },
  tour: {
    kind: 'tour',
    weekdays: [1, 2, 3, 4, 5],
    start: 10 * 60,
    end: 11 * 60 + 30,
    leadMinutes: 15,
    category: 'town',
    label: '工場見学会',
    description: '平日の朝の工場見学会の見本です。始まる 15 分前に受付をします。',
  },
}

type Spot = [town: string, pref: string, city: string, lat: number, lng: number, kinds: EventKind[]]

const SPOTS: Spot[] = [
  ['函館', '北海道', '函館市', 41.77, 140.72, ['fireworks']],
  ['札幌', '北海道', '札幌市', 43.06, 141.35, ['tour']],
  ['松島', '宮城県', '松島町', 38.37, 141.06, ['fireworks']],
  ['仙台', '宮城県', '仙台市', 38.26, 140.87, ['tour']],
  ['隅田川', '東京都', '墨田区', 35.71, 139.8, ['fireworks', 'tour']],
  ['横浜', '神奈川県', '横浜市', 35.45, 139.64, ['fireworks', 'tour']],
  ['長岡', '新潟県', '長岡市', 37.45, 138.85, ['fireworks']],
  ['諏訪', '長野県', '諏訪市', 36.05, 138.09, ['fireworks']],
  ['安曇野', '長野県', '安曇野市', 36.3, 137.9, ['tour']],
  ['熱海', '静岡県', '熱海市', 35.1, 139.07, ['fireworks']],
  ['名古屋', '愛知県', '名古屋市', 35.17, 136.88, ['tour']],
  ['大阪', '大阪府', '大阪市', 34.7, 135.49, ['fireworks', 'tour']],
  ['宮島', '広島県', '廿日市市', 34.3, 132.32, ['fireworks']],
  ['広島', '広島県', '広島市', 34.39, 132.46, ['tour']],
  ['松山', '愛媛県', '松山市', 33.84, 132.77, ['fireworks']],
  ['福岡', '福岡県', '福岡市', 33.59, 130.4, ['fireworks', 'tour']],
  ['那覇', '沖縄県', '那覇市', 26.21, 127.68, ['fireworks']],
]

/** 見本のイベント 1 つ（開催日は、旅の日程から決める） */
export interface EventEntry {
  name: string
  pref: string
  city: string
  lat: number
  lng: number
  rule: EventRule
}

export const EVENT_CATALOGUE: readonly EventEntry[] = SPOTS.flatMap(([town, pref, city, lat, lng, kinds]) =>
  kinds.map((kind) => ({ name: `見本の${RULES[kind].label}（${town}）`, pref, city, lat, lng, rule: RULES[kind] })),
)

const WORDS: Record<EventKind, string[]> = {
  fireworks: ['花火'],
  tour: ['見学会', '工場見学', '見学ツアー', '社会科見学'],
}
/**
 * どちらの種類か分からない、イベントの言葉（両方の種類から探す）。「見学」の 1 語は入れない
 * （「酒蔵を見学したい」「お城を見学したい」のような、ふつうの場所さがしまで Gemini に聞かなくなるため）
 */
const ANY_WORDS = ['イベント', '催し']

/**
 * やりたいことが、時刻が決まったイベントさがしか。そうなら探す種類、違えば null。
 * 「花火」なら花火大会、「見学会」「工場見学」なら見学会、「イベント」「催し」だけならどちらも
 */
export function wantsEvent(text: string): EventKind[] | null {
  const plain = text.normalize('NFKC')
  const kinds = (Object.keys(WORDS) as EventKind[]).filter((kind) => WORDS[kind].some((word) => plain.includes(word)))
  if (kinds.length > 0) return kinds
  return ANY_WORDS.some((word) => plain.includes(word)) ? ['fireworks', 'tour'] : null
}

export interface EventSearch {
  kinds: readonly EventKind[]
  /** 地図で映していた範囲。null は日本全体 */
  bounds: MapBounds | null
  /** 候補を出してよい県。null は絞らない */
  prefectures: readonly string[] | null
  /** 文に書かれた県（「長野で花火」）。空なら絞らない（logic の detectArea） */
  named: readonly string[]
  /** この旅にもうあるピンの名前 */
  exclude: readonly string[]
  /** 旅の開始日（YYYY-MM-DD）と日数 */
  startDate: string
  days: number
}

/** 見つかったイベント。ピンの場所と、開催の情報 */
export interface FoundEvent {
  place: SuggestedPlace
  event: PinEvent
}

const inside = (bounds: MapBounds, lat: number, lng: number) =>
  lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west

/**
 * 旅の日程のあいだに開催される見本のイベントを、決めた数まで選ぶ。開催日は、日程の中でいちばん早い開催の日。
 * - 旅の県（prefectures）の外は出さない。文に県があれば（named）、その県だけ
 * - 地図の範囲の中にあれば、範囲の中だけから。範囲の中になければ、範囲の真ん中に近い順
 * - 1 つもなければ空（呼ぶ側が「この日程のあいだに、この辺りでの開催は見つかりませんでした」と出す）
 */
export function searchEvents(search: EventSearch, catalogue: readonly EventEntry[] = EVENT_CATALOGUE): FoundEvent[] {
  const dates = datesOf(search.startDate, search.days)
  const held = catalogue.flatMap((entry) => {
    if (!search.kinds.includes(entry.rule.kind)) return []
    if (search.prefectures && !search.prefectures.includes(entry.pref)) return []
    if (search.named.length > 0 && !search.named.includes(entry.pref)) return []
    if (search.exclude.includes(entry.name)) return []
    const date = dates.find((item) => entry.rule.weekdays.includes(weekdayOf(item)))
    return date ? [{ entry, date }] : []
  })
  const bounds = search.bounds
  let ordered = held
  if (bounds) {
    const within = held.filter(({ entry }) => inside(bounds, entry.lat, entry.lng))
    const centerLat = (bounds.north + bounds.south) / 2
    const centerLng = (bounds.east + bounds.west) / 2
    const away = ({ entry }: { entry: EventEntry }) => (entry.lat - centerLat) ** 2 + (entry.lng - centerLng) ** 2
    ordered = (within.length > 0 ? within : held).slice().sort((left, right) => away(left) - away(right))
  }
  return ordered.slice(0, MAX_CANDIDATES).map(({ entry, date }) => ({
    place: {
      name: entry.name,
      description: entry.rule.description,
      area: `${entry.pref}${entry.city}`,
      category: entry.rule.category,
      location: { lat: entry.lat, lng: entry.lng },
    },
    event: {
      kind: entry.rule.kind,
      date,
      start: entry.rule.start,
      end: entry.rule.end,
      leadMinutes: entry.rule.leadMinutes,
      source: EVENT_SOURCE,
    },
  }))
}
