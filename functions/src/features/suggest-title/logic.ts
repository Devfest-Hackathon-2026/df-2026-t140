import { REGION_IDS, REGION_NAMES, REGION_PREFECTURES } from '../../domain/region'
import { isTravelMode } from '../../domain/travelMode'
import { placeNameEn } from './logic/placeNameEn'
import type { SuggestTitleInput, SuggestTitleOutput } from './types'

// 旅の名前を Gemini に考えてもらう（旅をつくる画面の「Gemini におまかせ」。企画書「ユーザー体験」1）の、入力の確かめと、応答の確かめ、固定の応答

/**
 * 名前の長さの上限。旅の名前の上限（firestore.rules、TRIP_TITLE_MAX = 40）より短く、帯に 1 行で収まる長さにする。
 * 日本語は 10 文字（390px の幅でメンバーの顔が 3 人のとき、名前に使える幅は約 144px。14px の字で 10 文字が入る。
 * Lazyturtle0852 の決定、2026-11-23）。英語は字の幅が狭いので 18 文字
 */
export const TITLE_MAX = 10
export const TITLE_MAX_EN = 18

/**
 * 名前の上限。ラテン文字（ō などの記号つきも）と、英語でよく使う記号（’ – など）だけなら英語の上限、
 * それ以外（日本語）が混じれば日本語の上限
 */
export function titleMax(title: string): number {
  return /^[\x20-\x7e\u00a0-\u024f\u2010-\u2027]*$/.test(title) ? TITLE_MAX_EN : TITLE_MAX
}
const DATE = /^\d{4}-\d{2}-\d{2}$/
const ALL_PREFECTURES = new Set(REGION_IDS.flatMap((id) => REGION_PREFECTURES[id]))

/** 画面から来たものを確かめる。形が違えば null */
export function readTitleInput(raw: unknown): SuggestTitleInput | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const { startDate, endDate, origin, travelMode, prefectures, language } = value
  if (typeof startDate !== 'string' || !DATE.test(startDate)) return null
  if (endDate !== null && (typeof endDate !== 'string' || !DATE.test(endDate) || endDate < startDate)) return null
  if (typeof origin !== 'string' || origin.trim().length === 0 || origin.trim().length > 40) return null
  if (!isTravelMode(travelMode)) return null
  if (!Array.isArray(prefectures) || prefectures.length === 0 || prefectures.length > ALL_PREFECTURES.size) return null
  if (!prefectures.every((name) => typeof name === 'string' && ALL_PREFECTURES.has(name))) return null
  if (language !== undefined && language !== 'ja' && language !== 'en') return null
  return {
    startDate, endDate, origin: origin.trim(), travelMode, prefectures: [...new Set(prefectures as string[])],
    ...(language ? { language } : {}),
  }
}

/** 何泊か（日帰りは 0） */
export function nightsOf(input: Pick<SuggestTitleInput, 'startDate' | 'endDate'>): number {
  if (!input.endDate) return 0
  return Math.round((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000)
}

/** 季節を表す言葉。3〜5 月は春、6〜8 月は夏、9〜11 月は秋、12〜2 月は冬 */
export function seasonWord(date: string): string {
  const month = Number(date.slice(5, 7))
  if (month >= 3 && month <= 5) return '春'
  if (month >= 6 && month <= 8) return '夏'
  if (month >= 9 && month <= 11) return '秋'
  return '冬'
}

/** 選んだ場所を言葉にする。地方を丸ごと選んでいれば地方の名前、そうでなければ県の名前。すべてなら「全国」 */
export function placeNames(prefectures: readonly string[]): string[] {
  if (prefectures.length === ALL_PREFECTURES.size) return ['全国']
  const picked = new Set(prefectures)
  return REGION_IDS.flatMap((id) => {
    const inside = REGION_PREFECTURES[id]
    const chosen = inside.filter((name) => picked.has(name))
    if (chosen.length === 0) return []
    return chosen.length === inside.length ? [REGION_NAMES[id]] : chosen
  })
}

/** 応答の JSON を確かめる。{ "title": "…" } で、空でなく、日本語なら TITLE_MAX、英語なら TITLE_MAX_EN 文字まで */
export function parseTitleOutput(json: unknown): SuggestTitleOutput {
  const title = json && typeof json === 'object' ? (json as { title?: unknown }).title : undefined
  if (typeof title !== 'string') throw new Error('title がありません')
  const trimmed = title.replace(/\s+/g, ' ').trim()
  const max = titleMax(trimmed)
  if (trimmed.length === 0 || trimmed.length > max) throw new Error(`title は 1〜${max} 文字にします`)
  return { title: trimmed }
}

/** 固定の応答。季節と行き先から作る（「秋の北陸旅」「冬の北海道・東北 日帰り旅」） */
export function stubTitle(input: SuggestTitleInput): SuggestTitleOutput {
  const places = placeNames(input.prefectures)
  if (input.language === 'en') {
    const season = { 春: 'Spring', 夏: 'Summer', 秋: 'Fall', 冬: 'Winter' }[seasonWord(input.startDate)] ?? 'Japan'
    const where = placeNameEn(places[0])
    const dayTrip = nightsOf(input) === 0
    const title = dayTrip ? `${where} Day Trip` : `${season} in ${where}`
    return { title: title.length <= TITLE_MAX_EN ? title : dayTrip ? `${season} Day Trip` : `${season} Getaway` }
  }
  const where = places.length > 2 ? `${places[0]}ほか` : places.join('・')
  const title = `${seasonWord(input.startDate)}の${where}${nightsOf(input) === 0 ? ' 日帰り旅' : '旅'}`
  return { title: title.length > TITLE_MAX ? `${seasonWord(input.startDate)}の${places[0]}旅`.slice(0, TITLE_MAX) : title }
}
