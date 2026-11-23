import { isPinCategory, type LatLng, type PinCategory } from '../../../domain/pin'
import { REGION_PREFECTURES, regionAt } from '../../../domain/region'
import type { MapBounds } from '../../../domain/wish'
import type { SuggestedPlace, SuggestInput, SuggestOutput } from '../types'
import { AREA_ALIASES, PREFECTURES } from './areas'
import { CATALOGUE, type CatalogueEntry } from './catalogue'
import { CATALOGUE_EN } from '../../../domain/catalogueEnglish'
import { LODGING_AREAS, type LodgingArea, MEAL_AREAS } from './lodgings'

// 希望 → ピンの純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。
//   parseSuggestOutput  Gemini の応答の形を確かめる
//   pickCandidates      応答から、ピンにする候補を選ぶ（旅の地方の外の場所は捨てる）
//   searchCatalogue     固定の応答。見本の場所の一覧（catalogue.ts）から、言葉と範囲で選ぶ
//   wantsLodging        文が宿さがしかを見分ける
//   searchLodgings      宿さがしの固定の応答。泊まる所の多いエリア（lodgings.ts）から、範囲に近い順に選ぶ
//   searchMeals         ごはんのお店さがしの固定の応答。食べものの場所と街の駅前（lodgings.ts）から、範囲に近い順に選ぶ

/** 1 つの希望から立てる候補のピンの数 */
export const MAX_CANDIDATES = 3

const NAME_MAX = 40
const DESCRIPTION_MAX = 140
const AREA_MAX = 30
const ENGLISH_NAME_MAX = 100
const ENGLISH_AREA_MAX = 100

/** 日本のおよその範囲。これより外の位置は、応答のまちがいとして捨てる */
const JAPAN: MapBounds = { north: 46, south: 20, east: 154, west: 122 }

/** 地図がこれより広い範囲（経度の幅）を映していたら、日本全体から探す */
const WIDE_LNG_SPAN = 12

/** ピンの ID。希望の ID と順番で決まるので、同じ希望を 2 回処理しても増えない */
export function candidatePinId(wishId: string, index: number): string {
  return `${wishId}-${index + 1}`
}

function inside(bounds: MapBounds, lat: number, lng: number): boolean {
  return lat <= bounds.north && lat >= bounds.south && lng <= bounds.east && lng >= bounds.west
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * Gemini の応答が決めた形かを確かめる。形が違えば例外を投げる（呼び出し口がやり直す）。
 * 個々の候補は、名前がない、位置が日本の外、などのものだけを捨てる。0 件は「見つからなかった」として通す。
 */
export function parseSuggestOutput(json: unknown): SuggestOutput {
  const list = (json as { places?: unknown } | null)?.places
  if (!Array.isArray(list)) throw new Error('places（配列）がありません')

  const places: SuggestedPlace[] = []
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue
    const name = text(item.name, NAME_MAX)
    const lat = item.lat
    const lng = item.lng
    if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inside(JAPAN, lat, lng)) continue
    const knownEnglish = CATALOGUE_EN[name]
    const nameEn = text(item.nameEn, ENGLISH_NAME_MAX) || knownEnglish?.[0]
    const areaEn = text(item.areaEn, ENGLISH_AREA_MAX) || knownEnglish?.[1]
    const descriptionEn = text(item.descriptionEn, DESCRIPTION_MAX) || knownEnglish?.[2]
    places.push({
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(item.namedMatch === true ? { namedMatch: true } : {}),
      description: text(item.description, DESCRIPTION_MAX),
      ...(descriptionEn ? { descriptionEn } : {}),
      area: text(item.area, AREA_MAX),
      ...(areaEn ? { areaEn } : {}),
      category: isPinCategory(item.category) ? item.category : 'town',
      location: { lat, lng },
      ...(item.lodgingKind === 'ryokan' || item.lodgingKind === 'hotel' ? { lodgingKind: item.lodgingKind } : {}),
    })
  }
  if (list.length > 0 && places.length === 0) throw new Error('使える候補が 1 つもありません')
  return { places }
}

/**
 * 場所がどの都道府県にあるか。area（「長野県安曇野市」）に都道府県の名前があればそれ。
 * なければ、位置が地方の形のどれの中にあるかで地方を決め（domain/region.ts の regionAt）、
 * その地方の中で真ん中がいちばん近い県にする（県境の近くではまちがえることがある）
 */
export function prefectureOf(place: { area: string; location: LatLng }): string {
  const area = place.area.normalize('NFKC')
  const named = PREFECTURES.find((pref) => area.includes(pref.name)) ?? PREFECTURES.find((pref) => area.startsWith(pref.short))
  if (named) return named.name
  const inside = REGION_PREFECTURES[regionAt(place.location)]
  let nearest = inside[0]
  let nearestKm = Infinity
  for (const pref of PREFECTURES) {
    if (!inside.includes(pref.name)) continue
    const km = distanceKm(place.location.lat, place.location.lng, pref.lat, pref.lng)
    if (km < nearestKm) {
      nearest = pref.name
      nearestKm = km
    }
  }
  return nearest
}

/**
 * 応答から、ピンにする候補を選ぶ。もうある場所と、同じ名前の重なりを除き、決めた数までにする。
 * prefectures（候補を出してよい県。null は絞らない）があれば、その外の場所は捨てる（#373）
 */
export function pickCandidates(
  output: SuggestOutput,
  exclude: readonly string[],
  prefectures: readonly string[] | null = null,
  max: number = MAX_CANDIDATES,
): SuggestedPlace[] {
  const seen = new Set(exclude)
  const picked: SuggestedPlace[] = []
  const ordered = [...output.places].sort((a, b) => Number(b.namedMatch === true) - Number(a.namedMatch === true))
  for (const place of ordered) {
    if (seen.has(place.name)) continue
    if (prefectures && !prefectures.includes(prefectureOf(place))) continue
    seen.add(place.name)
    picked.push(place)
    if (picked.length === max) break
  }
  return picked
}

// ---- 固定の応答：見本の場所の一覧から選ぶ ----

/** 言葉から場所の種類を見分ける */
const CATEGORY_WORDS: Record<PinCategory, string[]> = {
  onsen: ['温泉', '湯', '露天', '風呂', 'サウナ', 'スパ'],
  ski: ['スキー', 'スノボ', 'スノーボード', '滑り', '滑る', 'ゲレンデ', '雪'],
  food: [
    'グルメ', '食べ', 'ごはん', 'ご飯', 'ランチ', 'ラーメン', '寿司', '海鮮', 'そば', '蕎麦', 'うどん', '肉', '屋台',
    '市場', '名物', '美味', 'おいしい', 'うまい', 'スイーツ', '飲み', '酒', '料理',
  ],
  farm: ['農園', '農場', '牧場', 'わさび', '狩り', '畑', '収穫'],
  nightview: ['夜景', '星', 'イルミ', '展望', 'タワー', '夕日', '夕焼け'],
  nature: [
    '自然', '絶景', '景色', '滝', '湖', '山', '海', '川', '島', '紅葉', '高原', 'ハイキング', '登山', '渓', 'ビーチ',
    '花', '森',
  ],
  shrine: ['神社', '寺', '仏', '参拝', 'お参り', '御朱印', '城', '歴史', 'パワースポット', '大社', '神宮'],
  themepark: ['テーマパーク', '遊園地', 'ジェットコースター', '絶叫', 'アトラクション', '水族館', '動物園', '遊び'],
  town: ['街歩き', '町歩き', '町並み', '街並み', '散歩', '買い物', 'ショッピング', '観光', 'レトロ', '宿場', '土産'],
  // 宿は、見本の場所の一覧にはない。宿さがしかどうかは wantsLodging で見分け、searchLodgings で選ぶ
  lodging: [],
}

/** 宿さがしとみなす言葉（「宿」の 1 字は、地名に当たりやすいので下で別に見る） */
const LODGING_WORDS = [
  'ホテル', '旅館', '民宿', '宿泊', '泊ま', '泊り', '素泊', 'ゲストハウス', 'ホステル', 'ペンション', 'コテージ', 'グランピング',
  '貸別荘', '民泊', '宿坊', 'エアビ', 'airbnb',
]

/** 「宿」の字があっても、宿さがしではない言葉（地名、宿場の名前など） */
const NOT_LODGING_WORDS = [
  '新宿', '原宿', '指宿', '宿毛', '宿根木', '宿場', '下宿', '宿題', '雨宿', '馬籠宿', '大内宿', '海野宿', '熊川宿', '関宿', '宿り',
]

/**
 * 文が宿さがしか（「いい宿に泊まりたい」「駅前のホテル」「〇〇旅館」）。
 * 「宿」の 1 字は、地名（新宿、原宿）、宿場の名前（見本の一覧の「奈良井宿」など）を取り除いてから見る
 */
export function wantsLodging(wishText: string): boolean {
  const english = normalizeEnglish(wishText)
  if (/\b(?:hotels?|motels?|hostels?|lodging|accommodations?|guest\s?houses?|ryokan|overnight stay|place to stay)\b/.test(english)) {
    const destination = englishDestination(english)
    const isCataloguePlace = CATALOGUE.some((entry) => {
      const nameEn = CATALOGUE_EN[entry.name]?.[0]
      return nameEn && englishDestination(normalizeEnglish(nameEn)) === destination
    })
    if (!isCataloguePlace) return true
  }
  let rest = normalize(wishText)
  for (const word of [...NOT_LODGING_WORDS, ...CATALOGUE.filter((entry) => entry.name.includes('宿')).map((entry) => entry.name)]) {
    rest = rest.replaceAll(normalize(word), '')
  }
  // 「宿」の 1 字は、前が漢字でないとき（「いい宿」「の宿」「宿に」）と「温泉宿」だけ当てる。前が漢字の「〜宿」は、宿場や地名（三島宿、御宿）や別の言葉（合宿）が多い
  return /(^|[^\u4e00-\u9fff]|泉)宿/.test(rest) || LODGING_WORDS.some((word) => rest.includes(normalize(word)))
}

const ENGLISH_CATEGORY_WORDS: Record<Exclude<PinCategory, 'lodging'>, RegExp> = {
  onsen: /\b(?:hot springs?|onsen|spa|sauna)\b/i,
  ski: /\b(?:ski(?:ing)?|snowboard(?:ing)?)\b/i,
  food: /\b(?:food|eat|gourmet|lunch|dinner|breakfast|ramen|sushi|seafood|soba|udon|market)\b/i,
  farm: /\b(?:farm|farms|farmhouse|ranch|wasabi|fruit picking|vineyard)\b/i,
  nightview: /\b(?:night views?|city lights|city at night|stargazing|night skyline)\b/i,
  nature: /\b(?:nature|hike|hiking|waterfalls?|lakes?|mountains?|beach|forests?|scenery|fall colors)\b/i,
  shrine: /\b(?:shrines?|temples?|castles?|historic sites?|history)\b/i,
  themepark: /\b(?:theme park|amusement park|roller coasters?|aquariums?|zoos?)\b/i,
  town: /\b(?:shopping|sightseeing|old town|souvenirs?)\b/i,
}

function englishDestination(wish: string): string {
  return wish
    .replace(/^(?:(?:i |we )?(?:(?:would like|want) to )?(?:go to|visit|see|find)\s+)/, '')
    .replace(/[\s',.!?"’–-]+/g, '')
}

function normalizeEnglish(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase()
}

function englishAreaOf(entry: CatalogueEntry): string[] {
  return CATALOGUE_EN[entry.name]?.[1].split(', ').map(normalizeEnglish) ?? []
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

// 固定応答では、施設名だけの入力と、末尾に訪問・検索の意図がある入力を指定として扱う。
const DESTINATION_REQUESTS = new Set([
  '', '行きたい', '行く', '行こう', '行ってみたい', 'いきたい', 'いく', 'いこう', 'いってみたい',
  '寄りたい', '寄る', '寄ってみたい', '立ち寄りたい', '立ち寄る', '立ち寄ってみたい',
  '見たい', '見てみたい', '見に行きたい', '見学したい', '訪れたい', '訪れてみたい', '訪問したい',
  '観光したい', '探したい', '検索したい', '検索',
  '遊びたい', '楽しみたい', '入りたい', '滑りたい', '乗りたい', '食べたい',
])

type PlaceMention = 'destination' | 'reference' | 'ambiguous'

const PLACE_ALIASES: Record<string, readonly string[]> = {
  'ユニバーサル・スタジオ・ジャパン': ['USJ', 'ユニバ'],
}

const SHRINE_REQUESTS = new Set(['参拝したい', '参拝する', 'お参りしたい', 'お参りする', '御朱印をもらいたい', '御朱印をいただきたい'])

function classifyMention(before: string, after: string, category: PinCategory): PlaceMention {
  const prefix = before.split(/[。.！？!?]/).at(-1)?.replace(/[「『（(]+$/, '') ?? ''
  const ending = after.split(/[。.！？!?]/, 1)[0].replace(/^[」』）)]+|[」』）)]+$/g, '')
  // 集合場所の前に市区町村などが付いても、読点を越えて次の訪問希望まで取り込まない。
  const startsAt = /(?:出発(?:地|地点|場所)?|起点|集合(?:地|地点|場所)?|目印)(?:は|が|:)(?:[^、,]+の)?$/.test(prefix)
  const refersTo = /^(?:から|を出発|に集合|の?(?:そば|近く|周辺|付近|あたり|辺り)|以外|ではなく|じゃなく|には行かず)/.test(ending)
  if (startsAt || refersTo) return 'reference'
  const request = ending
    .replace(/^[にへをがもで]/, '')
    .replace(/^(?:ぜひ|一度は?|絶対に?)/, '')
    .replace(/(?:と思(?:う|います|っている|っています)|です[ねよ]?|ん(?:だ|です)(?:けど|が)?|なあ?|ね|よ)$/, '')
  // 一覧にない施設を先に書いた場合も、施設らしい語尾と区切りの組み合わせで列挙を見分ける。
  const followsAnotherPlace = /(?:寺|神社|神宮|大社|城|公園|温泉|駅|館|園|場|山|川|島|ホテル|タワー|ランド|パーク)[」』）)]*(?:と|や|、|,|・|および|及び|[/&])$/.test(prefix)
  const shrineVisit = category === 'shrine' && ending.startsWith('で') && SHRINE_REQUESTS.has(request)
  return !followsAnotherPlace && (DESTINATION_REQUESTS.has(request) || shrineVisit) ? 'destination' : 'ambiguous'
}

/** 長い名前を先に照合し、施設への言及が希望の中でどんな役割かを調べる。 */
function namedCatalogueEntries(text: string, catalogue: readonly CatalogueEntry[]): Map<CatalogueEntry, PlaceMention> {
  const names = catalogue.flatMap((entry) => [entry.name, ...(PLACE_ALIASES[entry.name] ?? [])]
    .map((name) => ({ entry, name: normalize(name), alias: name !== entry.name })))
  names.sort((a, b) => b.name.length - a.name.length)
  const matches = new Map<CatalogueEntry, PlaceMention>()
  let rest = text
  for (const { entry, name, alias } of names) {
    rest = rest.replaceAll(name, (match, index) => {
      const before = text.slice(0, index)
      const after = text.slice(index + match.length)
      if (alias && /^[a-z0-9]+$/.test(name) && (/[a-z0-9]$/.test(before) || /^[a-z0-9]/.test(after))) return match
      if (alias && /^[ァ-ヿ]+$/.test(name) && (/[ァ-ヿ]$/.test(before) || /^[ァ-ヿ]/.test(after))) return match
      if (!/^[市区町村]/.test(after)) {
        const role = classifyMention(before, after, entry.category)
        const previous = matches.get(entry)
        if (!previous || previous === 'reference' || role === 'destination') matches.set(entry, role)
      }
      return ' '.repeat(match.length)
    })
  }
  return matches
}

/** 文に書かれた地名（都道府県、地方）を見つける。rest は、地名を取り除いた残りの文 */
export function detectArea(wishText: string): { prefs: string[]; rest: string } {
  // 「東京都」の中の「京都」を、京都と見まちがえないようにする
  let rest = normalize(wishText).replaceAll('東京都', '東京')
  const prefs = new Set<string>()
  for (const [alias, names] of Object.entries(AREA_ALIASES)) {
    if (!rest.includes(alias)) continue
    names.forEach((name) => prefs.add(name))
    rest = rest.replaceAll(alias, '')
  }
  for (const pref of PREFECTURES) {
    if (!rest.includes(pref.short)) continue
    prefs.add(pref.name)
    rest = rest.replaceAll(new RegExp(`${pref.short}[都道府県]?`, 'g'), '')
  }
  return { prefs: [...prefs], rest }
}

/** 文から場所の種類を見つける。地名を取り除いた文を渡す（「山形」の「山」を自然と見まちがえないため） */
export function detectCategories(rest: string): PinCategory[] {
  return (Object.keys(CATEGORY_WORDS) as PinCategory[]).filter((category) =>
    CATEGORY_WORDS[category].some((word) => rest.includes(normalize(word))),
  )
}

/** 「安曇野市」→「安曇野」。1 文字になるものは見分けに使わない */
function localityOf(entry: CatalogueEntry): string | null {
  const locality = entry.city.replace(/[市町村区]$/, '')
  return locality.length >= 2 ? locality : null
}

/** 2 点のおよその距離（km） */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  const y = lat2 - lat1
  return Math.hypot(x, y) * 111.2
}

function isWide(bounds: MapBounds | null): boolean {
  return !bounds || bounds.east - bounds.west >= WIDE_LNG_SPAN || bounds.east < bounds.west
}

function toPlace(entry: CatalogueEntry): SuggestedPlace {
  const english = CATALOGUE_EN[entry.name]
  return {
    name: entry.name,
    ...(english ? { nameEn: english[0], areaEn: english[1], descriptionEn: english[2] } : {}),
    description: entry.description,
    area: `${entry.pref}${entry.city}`,
    category: entry.category,
    location: { lat: entry.lat, lng: entry.lng },
  }
}

interface Scored {
  entry: CatalogueEntry
  index: number
  /** その種類の中での順番（0 がいちばんよく知られている） */
  rank: number
  /** 文に名前がそのまま書かれている */
  named: boolean
  /** 文に、名前か市町村の名前が書かれている */
  placeHit: boolean
  /** 文との合い方。0 は合わない */
  relevance: number
  /** 探す範囲（書かれた地名か、地図で映していた範囲）の中にある */
  inScope: boolean
  distance: number
}

/**
 * 固定の応答：見本の場所の一覧から、希望の言葉と探す範囲に合う場所を選ぶ。
 *
 * - 文に地名があれば（「新潟の温泉！」）、地図の範囲より地名を優先する
 * - 地名がなければ、地図で映していた範囲の中から。広く映していたら日本全体から
 * - 範囲の中にあれば、範囲の中だけから出す（3 件に満たなくても、範囲の外からは足さない）。
 *   範囲の中に 1 件もないときだけ、範囲に近い順に出す（長崎を見ているのに熊本城が混ざらないように）
 * - 言葉から種類が分からなければ、範囲の中のよく知られた場所を出す
 * - 旅に地方や県（input.prefectures）があれば、その中の場所だけから選ぶ（#373）
 */
export function searchCatalogue(input: SuggestInput, everywhere: readonly CatalogueEntry[] = CATALOGUE): SuggestedPlace[] {
  const allowed = input.prefectures
  const catalogue = allowed ? everywhere.filter((entry) => allowed.includes(entry.pref)) : everywhere
  // 「東京都」の中の「京都」を、京都と見まちがえないようにする
  const whole = normalize(input.text).replaceAll('東京都', '東京')
  const area = detectArea(input.text)

  const mentionedEntries = namedCatalogueEntries(whole, everywhere)
  const englishText = normalizeEnglish(input.text)
  const englishWords = new Set(englishText.match(/[a-z]+/g) ?? [])
  const englishName = englishDestination(englishText)
  if (englishName) {
    const matches = everywhere.filter((entry) => {
      const nameEn = CATALOGUE_EN[entry.name]?.[0]
      return nameEn && englishDestination(normalizeEnglish(nameEn)) === englishName
    })
    if (matches.length === 1) mentionedEntries.set(matches[0], 'destination')
  }
  const isNamed = (entry: CatalogueEntry) => mentionedEntries.get(entry) === 'destination'
  const possibleDestinations = [...mentionedEntries].filter(([, role]) => role !== 'reference')
  const onlyDestination = possibleDestinations.length === 1 ? possibleDestinations[0][0] : undefined
  // 1 文字の言葉（「海」「城」）は、地名の一部に当たりやすいので、種類の見分け（CATEGORY_WORDS）に任せる
  const hitTags = (entry: CatalogueEntry) =>
    (entry.tags ?? []).filter((tag) => tag.length >= 2 && whole.includes(normalize(tag)))
  // 市町村の名前が書かれている（「白馬でスキー」）
  const localityHit = (entry: CatalogueEntry) => {
    const locality = localityOf(entry)
    const [city] = englishAreaOf(entry)
    return (locality !== null && whole.includes(normalize(locality))) || englishWords.has(city)
  }

  // 当たった名前や言葉を取り除いてから、種類を見分ける（「熱海」の「海」を自然と見まちがえないため）
  let rest = area.rest
  for (const entry of mentionedEntries.keys()) rest = rest.replaceAll(normalize(entry.name), '')
  for (const entry of catalogue) {
    const words = hitTags(entry)
    const locality = localityOf(entry)
    if (locality && localityHit(entry)) words.push(locality)
    for (const word of words) rest = rest.replaceAll(normalize(word), '')
  }
  const categories = [...new Set([
    ...detectCategories(rest),
    ...(Object.keys(ENGLISH_CATEGORY_WORDS) as Array<keyof typeof ENGLISH_CATEGORY_WORDS>)
      .filter((category) => ENGLISH_CATEGORY_WORDS[category].test(englishText)),
  ])]

  // 市町村の名前が書かれていたら、その都道府県も探す範囲にする
  const areaPrefs = new Set(area.prefs)
  for (const entry of everywhere) {
    const [, prefecture] = englishAreaOf(entry)
    if (englishWords.has(prefecture)) areaPrefs.add(entry.pref)
  }
  for (const entry of catalogue) if (localityHit(entry)) areaPrefs.add(entry.pref)

  // 施設への言及は「清水寺のそばでランチ」のような検索でも、地図の範囲より優先して起点に使う。
  const namedEntry = areaPrefs.size === 0
    ? catalogue.find(isNamed) ?? catalogue.find((entry) => mentionedEntries.has(entry))
    : undefined
  if (namedEntry && mentionedEntries.get(namedEntry) === 'reference') areaPrefs.add(namedEntry.pref)
  const bounds = namedEntry ? null : input.bounds
  const wide = isWide(bounds)
  let center: { lat: number; lng: number } | null = null
  if (namedEntry) {
    center = { lat: namedEntry.lat, lng: namedEntry.lng }
  } else if (areaPrefs.size > 0) {
    const named = PREFECTURES.filter((pref) => areaPrefs.has(pref.name))
    center = {
      lat: named.reduce((sum, pref) => sum + pref.lat, 0) / named.length,
      lng: named.reduce((sum, pref) => sum + pref.lng, 0) / named.length,
    }
  } else if (bounds && !wide) {
    center = { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }
  }

  const seenInCategory = new Map<PinCategory, number>()
  const scored: Scored[] = catalogue
    .map((entry, index) => {
      const rank = seenInCategory.get(entry.category) ?? 0
      seenInCategory.set(entry.category, rank + 1)
      return { entry, index, rank }
    })
    .filter(({ entry }) => !input.exclude.includes(entry.name))
    .map(({ entry, index, rank }) => {
      const role = mentionedEntries.get(entry)
      const named = role === 'destination'
        || (role === 'ambiguous' && (possibleDestinations.length > 1 || categories.length === 0))
      const local = localityHit(entry)
      const matchesTags = (categories.length === 0 || !mentionedEntries.has(entry) || named) && hitTags(entry).length > 0
      let relevance = (matchesTags ? 2 : 0) + (categories.includes(entry.category) ? 1 : 0)
      if (relevance > 0 && local) relevance += 1
      const inScope =
        areaPrefs.size > 0 ? areaPrefs.has(entry.pref) : bounds && !wide ? inside(bounds, entry.lat, entry.lng) : true
      const distance = center ? distanceKm(center.lat, center.lng, entry.lat, entry.lng) : 0
      return { entry, index, rank, named, placeHit: named || local, relevance: named ? 10 : relevance, inScope, distance }
    })

  const byScope = (left: Scored, right: Scored) =>
    Number(right.named) - Number(left.named) ||
    Number(right.inScope) - Number(left.inScope) ||
    right.relevance - left.relevance ||
    left.distance - right.distance ||
    left.index - right.index

  let pool = scored.filter((item) => item.relevance > 0).sort(byScope)

  // 種類が分からず、場所だけが分かった（「白馬に行きたい」）か、何も分からない（「のんびりしたい」）とき：
  // 当たった場所の近く、なければ探す範囲の中のよく知られた場所を足す
  const anchor = pool.find((item) => item.placeHit)?.entry
  if (categories.length === 0 && pool.length < MAX_CANDIDATES && (pool.length === 0 || anchor)) {
    const others = scored
      .filter((item) => item.relevance === 0)
      .map((item) =>
        anchor ? { ...item, distance: distanceKm(anchor.lat, anchor.lng, item.entry.lat, item.entry.lng) } : item,
      )
      .sort((left, right) =>
        anchor
          ? left.distance - right.distance || left.index - right.index
          : Number(right.inScope) - Number(left.inScope) ||
            left.distance - right.distance ||
            // 範囲が日本全体のときは、種類が片寄らないよう、各種類の先頭から順に
            left.rank - right.rank ||
            left.index - right.index,
      )
    pool = [...pool, ...others]
  }

  // 範囲の中（か、名前を書かれた場所）があれば、範囲の外は足さない
  if (pool.some((item) => item.inScope || item.named)) pool = pool.filter((item) => item.inScope || item.named)
  return pool.slice(0, MAX_CANDIDATES).map(({ entry }) => ({
    ...toPlace(entry),
    ...(entry === onlyDestination && isNamed(entry) ? { namedMatch: true } : {}),
  }))
}

// ---- 宿さがしの固定の応答：泊まる所の多いエリアから選ぶ ----

/** 宿さがしで、ふるう前に集める候補の数（Gemini にも、固定の応答にも） */
export const LODGING_POOL = 6

/**
 * 宿さがしの固定の応答：泊まる所の多いエリア（lodgings.ts。温泉地と、街の駅前）から、探す範囲に近い順に選ぶ。
 * 宿そのものの名前は出さない（エリアまで。宿は場所カードの「Google マップ」で選んでもらう）。
 *
 * - 文にエリアの名前があれば（「草津の宿」「松本のホテル」）、そのエリアを先頭に、その近くから足す
 * - 文に都道府県や地方があれば、その中から
 * - どちらもなければ、地図で映していた範囲（「宿を探す」では、その日の最後の場所のまわり）の真ん中に近い順。
 *   広く映していたら、一覧の順（よく知られた温泉地から）
 * - 旅に地方や県（input.prefectures）があれば、その中のエリアだけから選ぶ（#373）
 */
export function searchLodgings(
  input: SuggestInput,
  everywhere: readonly LodgingArea[] = LODGING_AREAS,
  category: 'lodging' | 'food' = 'lodging',
): SuggestedPlace[] {
  const allowed = input.prefectures
  const whole = normalize(input.text).replaceAll('東京都', '東京')
  const english = ` ${englishSearchWords(input.text)} `
  const area = detectArea(input.text)
  const pool = everywhere
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (!allowed || allowed.includes(entry.pref)) && !input.exclude.includes(entry.name))
    .filter(({ entry }) => area.prefs.length === 0 || area.prefs.includes(entry.pref))
  // 1 文字の言葉（「津」）は、ほかの地名の一部に当たりやすいので、名前の見分けには使わない
  const isNamed = (entry: LodgingArea) =>
    entry.words.some((word) => word.length >= 2 && whole.includes(normalize(word))) ||
    entry.wordsEn?.some((word) => english.includes(` ${englishSearchWords(word)} `)) === true
  const named = pool.find(({ entry }) => isNamed(entry))?.entry
  const bounds = input.bounds
  const center = named
    ? { lat: named.lat, lng: named.lng }
    : area.prefs.length === 0 && bounds && !isWide(bounds)
      ? { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }
      : null
  return pool
    .map((item) => ({
      ...item,
      named: isNamed(item.entry),
      distance: center ? distanceKm(center.lat, center.lng, item.entry.lat, item.entry.lng) : 0,
    }))
    .sort((left, right) => Number(right.named) - Number(left.named) || left.distance - right.distance || left.index - right.index)
    // しおりの様子があるときは、着く時刻と寄り道でふるう（usecase の rankLodgings）ので、多めに返す
    .slice(0, input.lodgingContext ? LODGING_POOL : MAX_CANDIDATES)
    .map(({ entry }) => ({
      name: entry.name,
      description: entry.description,
      area: `${entry.pref}${entry.city}`,
      ...(entry.nameEn ? { nameEn: entry.nameEn } : {}),
      ...(entry.descriptionEn ? { descriptionEn: entry.descriptionEn } : {}),
      ...(entry.areaEn ? { areaEn: entry.areaEn } : {}),
      category,
      location: { lat: entry.lat, lng: entry.lng },
    }))
}

/** ごはんのお店さがしの固定の応答：食べものの場所と街の駅前（lodgings.ts の MEAL_AREAS）から、宿さがしと同じ決めで選ぶ */
export function searchMeals(input: SuggestInput): SuggestedPlace[] {
  return searchLodgings(input, MEAL_AREAS, 'food')
}

function englishSearchWords(text: string): string {
  return normalizeEnglish(text).replace(/[^a-z0-9]+/g, ' ').trim()
}
