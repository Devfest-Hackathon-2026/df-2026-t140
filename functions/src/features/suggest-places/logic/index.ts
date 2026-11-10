import { isPinCategory, type PinCategory } from '../../../domain/pin'
import type { MapBounds } from '../../../domain/wish'
import type { SuggestedPlace, SuggestInput, SuggestOutput } from '../types'
import { AREA_ALIASES, PREFECTURES } from './areas'
import { CATALOGUE, type CatalogueEntry } from './catalogue'

// 希望 → ピンの純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。
//   parseSuggestOutput  Gemini の応答の形を確かめる
//   pickCandidates      応答から、ピンにする候補を選ぶ
//   searchCatalogue     固定の応答。見本の場所の一覧（catalogue.ts）から、言葉と範囲で選ぶ

/** 1 つの希望から立てる候補のピンの数 */
export const MAX_CANDIDATES = 3

const NAME_MAX = 40
const DESCRIPTION_MAX = 140
const AREA_MAX = 30

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
    places.push({
      name,
      description: text(item.description, DESCRIPTION_MAX),
      area: text(item.area, AREA_MAX),
      category: isPinCategory(item.category) ? item.category : 'town',
      location: { lat, lng },
    })
  }
  if (list.length > 0 && places.length === 0) throw new Error('使える候補が 1 つもありません')
  return { places }
}

/** 応答から、ピンにする候補を選ぶ。もうある場所と、同じ名前の重なりを除き、決めた数までにする */
export function pickCandidates(output: SuggestOutput, exclude: readonly string[]): SuggestedPlace[] {
  const seen = new Set(exclude)
  const picked: SuggestedPlace[] = []
  for (const place of output.places) {
    if (seen.has(place.name)) continue
    seen.add(place.name)
    picked.push(place)
    if (picked.length === MAX_CANDIDATES) break
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
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
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
  return {
    name: entry.name,
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
 * - 範囲の中に足りなければ、範囲に近い順に足す
 * - 言葉から種類が分からなければ、範囲の中のよく知られた場所を出す
 */
export function searchCatalogue(input: SuggestInput, catalogue: readonly CatalogueEntry[] = CATALOGUE): SuggestedPlace[] {
  // 「東京都」の中の「京都」を、京都と見まちがえないようにする
  const whole = normalize(input.text).replaceAll('東京都', '東京')
  const area = detectArea(input.text)

  const isNamed = (entry: CatalogueEntry) => whole.includes(normalize(entry.name))
  // 1 文字の言葉（「海」「城」）は、地名の一部に当たりやすいので、種類の見分け（CATEGORY_WORDS）に任せる
  const hitTags = (entry: CatalogueEntry) =>
    (entry.tags ?? []).filter((tag) => tag.length >= 2 && whole.includes(normalize(tag)))
  // 市町村の名前が書かれている（「白馬でスキー」）
  const localityHit = (entry: CatalogueEntry) => {
    const locality = localityOf(entry)
    return locality !== null && whole.includes(normalize(locality))
  }

  // 当たった名前や言葉を取り除いてから、種類を見分ける（「熱海」の「海」を自然と見まちがえないため）
  let rest = area.rest
  for (const entry of catalogue) {
    const words = [...hitTags(entry), ...(isNamed(entry) ? [entry.name] : [])]
    const locality = localityOf(entry)
    if (locality && localityHit(entry)) words.push(locality)
    for (const word of words) rest = rest.replaceAll(normalize(word), '')
  }
  const categories = detectCategories(rest)

  // 市町村の名前が書かれていたら、その都道府県も探す範囲にする
  const areaPrefs = new Set(area.prefs)
  for (const entry of catalogue) if (localityHit(entry)) areaPrefs.add(entry.pref)

  // 名前がそのまま書かれた場所があれば（「白骨温泉に行きたい」）、地図の範囲ではなく、その近くから足す
  const namedEntry = areaPrefs.size === 0 ? catalogue.find(isNamed) : undefined
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
      const named = isNamed(entry)
      const local = localityHit(entry)
      let relevance = (hitTags(entry).length > 0 ? 2 : 0) + (categories.includes(entry.category) ? 1 : 0)
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

  return pool.slice(0, MAX_CANDIDATES).map((item) => toPlace(item.entry))
}
