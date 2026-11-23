import { translate as t } from '../../../shared/lib/language.ts'

// 大まかな場所（地方）。旅を作る人（発案者）が、旅を作るときに 1 つ以上選ぶ（企画書「ユーザー体験」1）。
// 選ぶ単位は 11 の地方（Youkin06 の決定、2026-11-16。#373）。すべて選ぶと、場所を絞らないという意味になる。
// 県まで決まっている旅では、選んだ地方の県を外して絞れる（下の「県で絞る」）。
// ID の一覧は firestore.rules の validRegions と、functions/src/domain/trip.ts の RegionId と合わせる。
// 地方の中の県は functions/src/domain/region.ts の REGION_PREFECTURES と合わせる。

export const REGION_IDS = [
  'hokkaido',
  'tohoku',
  'kanto',
  'koshinetsu',
  'hokuriku',
  'tokai',
  'kinki',
  'chugoku',
  'shikoku',
  'kyushu',
  'okinawa',
] as const

export type RegionId = (typeof REGION_IDS)[number]

export const REGION_NAMES: Record<RegionId, string> = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  koshinetsu: '甲信越',
  hokuriku: '北陸',
  tokai: '東海',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州',
  okinawa: '沖縄',
}

const REGION_ENGLISH: Record<RegionId, string> = {
  hokkaido: 'Hokkaido',
  tohoku: 'Tohoku',
  kanto: 'Kanto',
  koshinetsu: 'Koshinetsu',
  hokuriku: 'Hokuriku',
  tokai: 'Tokai',
  kinki: 'Kinki',
  chugoku: 'Chugoku',
  shikoku: 'Shikoku',
  kyushu: 'Kyushu',
  okinawa: 'Okinawa',
}

const PREFECTURE_ENGLISH: Record<string, string> = {
  北海道: 'Hokkaido', 青森県: 'Aomori', 岩手県: 'Iwate', 宮城県: 'Miyagi', 秋田県: 'Akita', 山形県: 'Yamagata',
  福島県: 'Fukushima', 茨城県: 'Ibaraki', 栃木県: 'Tochigi', 群馬県: 'Gunma', 埼玉県: 'Saitama', 千葉県: 'Chiba',
  東京都: 'Tokyo', 神奈川県: 'Kanagawa', 新潟県: 'Niigata', 山梨県: 'Yamanashi', 長野県: 'Nagano', 富山県: 'Toyama',
  石川県: 'Ishikawa', 福井県: 'Fukui', 岐阜県: 'Gifu', 静岡県: 'Shizuoka', 愛知県: 'Aichi', 三重県: 'Mie',
  滋賀県: 'Shiga', 京都府: 'Kyoto', 大阪府: 'Osaka', 兵庫県: 'Hyogo', 奈良県: 'Nara', 和歌山県: 'Wakayama',
  鳥取県: 'Tottori', 島根県: 'Shimane', 岡山県: 'Okayama', 広島県: 'Hiroshima', 山口県: 'Yamaguchi', 徳島県: 'Tokushima',
  香川県: 'Kagawa', 愛媛県: 'Ehime', 高知県: 'Kochi', 福岡県: 'Fukuoka', 佐賀県: 'Saga', 長崎県: 'Nagasaki',
  熊本県: 'Kumamoto', 大分県: 'Oita', 宮崎県: 'Miyazaki', 鹿児島県: 'Kagoshima', 沖縄県: 'Okinawa',
}

export function regionDisplayName(id: RegionId): string {
  return t(REGION_NAMES[id], REGION_ENGLISH[id])
}

export function prefectureDisplayName(name: string): string {
  return t(name, Object.hasOwn(PREFECTURE_ENGLISH, name) ? PREFECTURE_ENGLISH[name] : name)
}

export function areaDisplayName(name: string): string {
  const region = REGION_IDS.find((id) => REGION_NAMES[id] === name)
  return region ? regionDisplayName(region) : prefectureDisplayName(name)
}

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === 'string' && (REGION_IDS as readonly string[]).includes(value)
}

/** 重なりと知らない ID を落とし、北から南の順（REGION_IDS の順）にそろえる */
export function normalizeRegions(ids: readonly string[]): RegionId[] {
  return REGION_IDS.filter((id) => ids.includes(id))
}

/** 1 つ足す、または外す */
export function toggleRegion(ids: readonly RegionId[], id: RegionId): RegionId[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : normalizeRegions([...ids, id])
}

/** すべて選んでいるか（場所を絞らない） */
export function isAllRegions(ids: readonly string[]): boolean {
  return normalizeRegions(ids).length === REGION_IDS.length
}

/** 「東北・北陸」。すべてなら「全国」、なければ空の文字列 */
export function regionsLabel(ids: readonly string[]): string {
  const regions = normalizeRegions(ids)
  if (regions.length === REGION_IDS.length) return t('全国', 'All Japan')
  return regions.map(regionDisplayName).join(t('・', ', '))
}

/** 上の帯などの狭い所に出す短い名前。「東北・北陸」「東北ほか2」「全国」 */
export function regionsShortLabel(ids: readonly string[]): string {
  const regions = normalizeRegions(ids)
  if (regions.length === REGION_IDS.length) return t('全国', 'All Japan')
  const names = regions.map(regionDisplayName)
  if (names.length <= 2) return names.join(t('・', ', '))
  return t(`${names[0]}ほか${names.length - 1}`, `${names[0]} +${names.length - 1}`)
}

/** 選び方に足りないところがあれば、画面に出す文を返す。よければ null */
export function regionsProblem(ids: readonly string[]): string | null {
  return normalizeRegions(ids).length === 0 ? t('大まかな場所を 1 つ以上選んでください', 'Choose at least one region or prefecture') : null
}

// ---- 県で絞る ----

export const REGION_PREFECTURES: Record<RegionId, readonly string[]> = {
  hokkaido: ['北海道'],
  tohoku: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  kanto: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  koshinetsu: ['新潟県', '山梨県', '長野県'],
  hokuriku: ['富山県', '石川県', '福井県'],
  tokai: ['岐阜県', '静岡県', '愛知県', '三重県'],
  kinki: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  chugoku: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  shikoku: ['徳島県', '香川県', '愛媛県', '高知県'],
  kyushu: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県'],
  okinawa: ['沖縄県'],
}

export const ALL_PREFECTURES: readonly string[] = REGION_IDS.flatMap((id) => REGION_PREFECTURES[id])

/**
 * 選んだ場所。picked は選んだ県の名前（地方を丸ごと選んだら、その地方の県が全部入る）。
 * 旅には、地方（regions）と、県まで絞ったときだけ県（prefectures）を保存する（toTripArea）
 */
export type PickedPrefectures = readonly string[]

/** 重なりと知らない県を落とし、北から南の順にそろえる */
export function normalizePrefectures(names: readonly string[]): string[] {
  return ALL_PREFECTURES.filter((name) => names.includes(name))
}

/** 旅に保存してある地方と県から、選んだ県を戻す（県がなければ、地方の県を全部） */
export function pickedFromTrip(regions: readonly string[] | undefined, prefectures: readonly string[] | undefined): string[] {
  if (prefectures && prefectures.length > 0) return normalizePrefectures(prefectures)
  return normalizeRegions(regions ?? []).flatMap((id) => REGION_PREFECTURES[id])
}

/** 地方を押したとき：その地方の県が 1 つでも選ばれていれば全部外し、なければ全部選ぶ */
export function toggleRegionPrefectures(picked: PickedPrefectures, id: RegionId): string[] {
  const inside = REGION_PREFECTURES[id]
  const touched = inside.some((name) => picked.includes(name))
  return normalizePrefectures(touched ? picked.filter((name) => !inside.includes(name)) : [...picked, ...inside])
}

/** 県を押したとき：選ぶか外す */
export function togglePrefecture(picked: PickedPrefectures, name: string): string[] {
  return normalizePrefectures(picked.includes(name) ? picked.filter((item) => item !== name) : [...picked, name])
}

/** 県が 1 つでも選ばれている地方 */
export function regionsOfPicked(picked: PickedPrefectures): RegionId[] {
  return REGION_IDS.filter((id) => REGION_PREFECTURES[id].some((name) => picked.includes(name)))
}

/** 旅に保存する形。地方を丸ごと選んだだけなら prefectures は null（県まで絞ったときだけ保存する） */
export function toTripArea(picked: PickedPrefectures): { regions: RegionId[]; prefectures: string[] | null } {
  const regions = regionsOfPicked(picked)
  const narrowed = regions.some((id) => REGION_PREFECTURES[id].some((name) => !picked.includes(name)))
  return { regions, prefectures: narrowed ? normalizePrefectures(picked) : null }
}

/** 地方ごとの名前の並び。丸ごとなら地方名、絞ったらその県名（「甲信越」「石川県」） */
function pickedParts(picked: PickedPrefectures): string[] {
  return regionsOfPicked(picked).flatMap((id) => {
    const inside = REGION_PREFECTURES[id]
    const chosen = inside.filter((name) => picked.includes(name))
    return chosen.length === inside.length ? [regionDisplayName(id)] : chosen.map(prefectureDisplayName)
  })
}

/** 「甲信越・石川県」。全部なら「全国」、なければ空の文字列 */
export function pickedLabel(picked: PickedPrefectures): string {
  if (normalizePrefectures(picked).length === ALL_PREFECTURES.length) return t('全国', 'All Japan')
  return pickedParts(picked).join(t('・', ', '))
}

/** 狭い所に出す短い名前。「甲信越・石川県」「長野県ほか2」「全国」 */
export function pickedShortLabel(picked: PickedPrefectures): string {
  if (normalizePrefectures(picked).length === ALL_PREFECTURES.length) return t('全国', 'All Japan')
  const parts = pickedParts(picked)
  return parts.length <= 2 ? parts.join(t('・', ', ')) : t(`${parts[0]}ほか${parts.length - 1}`, `${parts[0]} +${parts.length - 1}`)
}

/**
 * 旅を作るときの仮の名前。「北陸の旅」「長野県・石川県の旅」「北陸ほかの旅」「全国の旅」。
 * 旅の名前は確定するときに決めるので（features/confirm-shiori）、それまでは選んだ場所から作った名前で呼ぶ
 */
export function provisionalTripTitle(picked: PickedPrefectures): string {
  if (normalizePrefectures(picked).length === ALL_PREFECTURES.length) return t('全国の旅', 'Trip around Japan')
  const parts = pickedParts(picked)
  if (parts.length === 0) return t('新しい旅', 'New trip')
  return parts.length <= 2 ? t(`${parts.join('・')}の旅`, `Trip to ${parts.join(' & ')}`) : t(`${parts[0]}ほかの旅`, `Trip to ${parts[0]} and more`)
}

// ---- 名前で探す ----

/** 地方と県の読み（ひらがな）。名前で探すときに、漢字でも読みでも当たるようにする */
const REGION_KANA: Record<RegionId, string> = {
  hokkaido: 'ほっかいどう',
  tohoku: 'とうほく',
  kanto: 'かんとう',
  koshinetsu: 'こうしんえつ',
  hokuriku: 'ほくりく',
  tokai: 'とうかい',
  kinki: 'きんき',
  chugoku: 'ちゅうごく',
  shikoku: 'しこく',
  kyushu: 'きゅうしゅう',
  okinawa: 'おきなわ',
}

const PREFECTURE_KANA: Record<string, string> = {
  北海道: 'ほっかいどう', 青森県: 'あおもり', 岩手県: 'いわて', 宮城県: 'みやぎ', 秋田県: 'あきた', 山形県: 'やまがた',
  福島県: 'ふくしま', 茨城県: 'いばらき', 栃木県: 'とちぎ', 群馬県: 'ぐんま', 埼玉県: 'さいたま', 千葉県: 'ちば',
  東京都: 'とうきょう', 神奈川県: 'かながわ', 新潟県: 'にいがた', 山梨県: 'やまなし', 長野県: 'ながの', 富山県: 'とやま',
  石川県: 'いしかわ', 福井県: 'ふくい', 岐阜県: 'ぎふ', 静岡県: 'しずおか', 愛知県: 'あいち', 三重県: 'みえ',
  滋賀県: 'しが', 京都府: 'きょうと', 大阪府: 'おおさか', 兵庫県: 'ひょうご', 奈良県: 'なら', 和歌山県: 'わかやま',
  鳥取県: 'とっとり', 島根県: 'しまね', 岡山県: 'おかやま', 広島県: 'ひろしま', 山口県: 'やまぐち', 徳島県: 'とくしま',
  香川県: 'かがわ', 愛媛県: 'えひめ', 高知県: 'こうち', 福岡県: 'ふくおか', 佐賀県: 'さが', 長崎県: 'ながさき',
  熊本県: 'くまもと', 大分県: 'おおいた', 宮崎県: 'みやざき', 鹿児島県: 'かごしま', 沖縄県: 'おきなわ',
}

/** カタカナをひらがなにし、空白を落とす（「ナガノ」「なが の」でも当たるように） */
function normalizeQuery(query: string): string {
  return query
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

/** 名前（漢字の一部か、読みの頭）で地方と県を探す。「なが」→ 長野県・長崎県、「甲信」→ 甲信越 */
export function searchAreas(query: string): { regions: RegionId[]; prefectures: string[] } {
  const q = normalizeQuery(query)
  if (!q) return { regions: [], prefectures: [] }
  const hit = (name: string, kana: string, english: string) =>
    name.includes(q) || kana.startsWith(q) || english.toLowerCase().includes(q.toLowerCase())
  // 県が 1 つだけの地方（北海道、沖縄）は、地方として出し、同じ名前の県は重ねて出さない
  const single = (name: string) => REGION_IDS.find((id) => REGION_PREFECTURES[id].length === 1 && REGION_PREFECTURES[id][0] === name)
  const prefectures = ALL_PREFECTURES.filter((name) => hit(name, PREFECTURE_KANA[name] ?? '', PREFECTURE_ENGLISH[name] ?? ''))
  const regions = REGION_IDS.filter((id) =>
    hit(REGION_NAMES[id], REGION_KANA[id], REGION_ENGLISH[id]) || prefectures.some((name) => single(name) === id))
  return { regions, prefectures: prefectures.filter((name) => !single(name)) }
}

/** その県のある地方 */
export function regionOfPrefecture(name: string): RegionId | undefined {
  return REGION_IDS.find((id) => REGION_PREFECTURES[id].includes(name))
}

/** 地方の県をすべて選ぶか、すべて外す */
export function setRegionPrefectures(picked: PickedPrefectures, id: RegionId, on: boolean): string[] {
  const inside = REGION_PREFECTURES[id]
  const rest = picked.filter((name) => !inside.includes(name))
  return normalizePrefectures(on ? [...rest, ...inside] : rest)
}

/** まだ県を 1 つも選んでいない地方（サイコロで選ぶ先） */
export function untouchedRegions(picked: PickedPrefectures): RegionId[] {
  return REGION_IDS.filter((id) => REGION_PREFECTURES[id].every((name) => !picked.includes(name)))
}
