// 府県の天気予報（気象庁の JSON）を、しおりに出す形に直す。SDK を使わない純粋な判断。
// 出典：気象庁「府県天気予報」（https://www.jma.go.jp/bosai/forecast/）。docs/records/credits.md に記録する。
import type { Sky } from './types'

/** 一度に調べる府県の数の上限（distinct）。超えたら断る（黙って削らない） */
export const MAX_PREFECTURES = 8

/**
 * 都道府県の名前と、気象庁の府県予報区のコード（6 桁）。
 * 名前は domain/region.ts の REGION_PREFECTURES と同じ（scripts/shiori-weather.test.mjs で確かめる）
 */
const OFFICE_CODES: ReadonlyArray<readonly [string, string]> = [
  ['北海道', '016000'],
  ['青森県', '020000'],
  ['岩手県', '030000'],
  ['宮城県', '040000'],
  ['秋田県', '050000'],
  ['山形県', '060000'],
  ['福島県', '070000'],
  ['茨城県', '080000'],
  ['栃木県', '090000'],
  ['群馬県', '100000'],
  ['埼玉県', '110000'],
  ['千葉県', '120000'],
  ['東京都', '130000'],
  ['神奈川県', '140000'],
  ['新潟県', '150000'],
  ['富山県', '160000'],
  ['石川県', '170000'],
  ['福井県', '180000'],
  ['山梨県', '190000'],
  ['長野県', '200000'],
  ['岐阜県', '210000'],
  ['静岡県', '220000'],
  ['愛知県', '230000'],
  ['三重県', '240000'],
  ['滋賀県', '250000'],
  ['京都府', '260000'],
  ['大阪府', '270000'],
  ['兵庫県', '280000'],
  ['奈良県', '290000'],
  ['和歌山県', '300000'],
  ['鳥取県', '310000'],
  ['島根県', '320000'],
  ['岡山県', '330000'],
  ['広島県', '340000'],
  ['山口県', '350000'],
  ['徳島県', '360000'],
  ['香川県', '370000'],
  ['愛媛県', '380000'],
  ['高知県', '390000'],
  ['福岡県', '400000'],
  ['佐賀県', '410000'],
  ['長崎県', '420000'],
  ['熊本県', '430000'],
  ['大分県', '440000'],
  ['宮崎県', '450000'],
  ['鹿児島県', '460100'],
  ['沖縄県', '471000'],
]

export const OFFICE_CODE_OF: ReadonlyMap<string, string> = new Map(OFFICE_CODES)

// https://www.jma.go.jp/bosai/common/const/area.json の offices
const EXTRA_OFFICES: Readonly<Record<string, readonly string[]>> = {
  北海道: ['011000', '012000', '013000', '014030', '014100', '015000', '017000'],
  鹿児島県: ['460040'],
  沖縄県: ['472000', '473000', '474000'],
}

/** 北海道・鹿児島・沖縄では、県に含まれる複数の予報区を返す */
export function officeCodesOf(prefecture: string): readonly string[] {
  const primary = OFFICE_CODE_OF.get(prefecture)
  return primary ? [primary, ...(EXTRA_OFFICES[prefecture] ?? [])] : []
}

/**
 * 画面から来た府県の名前を確かめる。正式な名前（「京都府」「東京都」など）だけを通し、重なりは 1 つにする。
 * 知らない名前・配列でないものは invalid、distinct で上限を超えたら too-many
 */
export function canonicalPrefectures(raw: unknown): { ok: true; names: string[] } | { ok: false; reason: 'invalid' | 'too-many' } {
  if (!Array.isArray(raw)) return { ok: false, reason: 'invalid' }
  const unique = [...new Set<unknown>(raw)]
  const names = unique.filter((name): name is string => typeof name === 'string' && OFFICE_CODE_OF.has(name))
  if (names.length !== unique.length) return { ok: false, reason: 'invalid' }
  if (names.length > MAX_PREFECTURES) return { ok: false, reason: 'too-many' }
  return { ok: true, names }
}

/** 予報の 1 行（府県は含まない）。area は予報区の名前（例：南部）で、そのまま出す */
export interface OfficeForecast {
  area: string
  date: string
  forecast: string
  /** 天気コードから引いた英語の概況。コードがないときは付けない */
  forecastEn?: string
  /** その日の天気の 4 つ（しおりの行のアイコン）。降水確率で雨・雪にする。4 つに分けられない予報ではない */
  sky?: Sky
  /** 短期予報の 6 時間ごとの天気（hour は区切りの始まりの時）。降水確率が 6 時間ごとにある日だけ */
  skies?: { hour: number; sky: Sky }[]
}

/** しおりに返す 1 行 */
export interface PrefectureForecast extends OfficeForecast {
  prefecture: string
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const field = (value: unknown, key: string): unknown => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined)

/** 天気の記号の先頭の 1 桁から、概況の言葉。1 晴れ、2 くもり、3 雨、4 雪。ほかの数字は知らないので null（作らない） */
const OVERVIEW_BY_DIGIT: Record<string, string> = { '1': '晴れ', '2': 'くもり', '3': '雨', '4': '雪' }
const ENGLISH_OVERVIEW: Record<string, string> = { 晴れ: 'Sunny', くもり: 'Cloudy', 雨: 'Rain', 雪: 'Snow' }
const ENGLISH_SKY: Record<Sky, string> = { sunny: 'Sunny', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow' }

export function overviewOf(weatherCode: unknown): string | null {
  if (typeof weatherCode !== 'string' || !/^\d{3}$/.test(weatherCode)) return null
  return OVERVIEW_BY_DIGIT[weatherCode.charAt(0)] ?? null
}

/** 「2026-11-21T11:00:00+09:00」などから日本時間の日付 YYYY-MM-DD を取る（時刻の変換はしない）。読めなければ null */
export function jstDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?:T|$)/.exec(value)
  return match ? match[1] : null
}

/** 今日の日本時間の日付（YYYY-MM-DD）。now はミリ秒 */
export function jstToday(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 気象庁の府県予報の JSON から、予報区ごと・日ごとの予報を取り出す。形が違うものは捨てる（読めた分だけ返す）。
 * 報告の 0 番目は短期（数日）、1 番目は週間。短期の文（天気の言葉）を優先し、週間は短期にない日だけ、天気の記号から概況を入れる。
 */
export function parseOfficeForecasts(json: unknown): OfficeForecast[] {
  const reports = list(json).slice(0, 2)
  const pops = parsePops(reports)
  const found = new Map<string, OfficeForecast>()
  reports.forEach((report, reportIndex) => {
    const isShortRange = reportIndex === 0
    for (const series of list(field(report, 'timeSeries'))) {
      const dates = list(field(series, 'timeDefines'))
      for (const area of list(field(series, 'areas'))) {
        const name = field(field(area, 'area'), 'name')
        if (typeof name !== 'string' || name.trim() === '') continue
        const texts = list(field(area, 'weathers'))
        const codes = list(field(area, 'weatherCodes'))
        dates.forEach((time, index) => {
          const date = jstDate(time)
          if (!date) return
          const key = `${name}\n${date}`
          if (found.has(key)) return
          const rawText = texts[index]
          const text = typeof rawText === 'string' ? rawText.trim() : ''
          const overview = overviewOf(codes[index])
          const forecast = (isShortRange && text) || overview
          if (!forecast) return
          const code = typeof codes[index] === 'string' ? (codes[index] as string) : ''
          const row: OfficeForecast = { area: name, date, forecast }
          // 4 つに分けられない予報（記号がなく、文が「霧」など）は、一覧の文だけ残し、アイコンは出さない
          const sky = skyParts(code, forecast)
          if (sky) {
            const pop = pops.get(key)
            row.sky = daySky(sky, pop?.blocks, pop?.daily)
            if (pop?.blocks.length) row.skies = pop.blocks.map(({ hour, pop: value }) => ({ hour, sky: blockSky(sky, value) }))
          }
          // 英語の概況。概況の言葉（「晴れ」）はそのまま訳す。短期予報の文（「晴れのち雨」）は訳せないので、アイコンと同じ空模様から作る
          const forecastEn = forecast === overview ? ENGLISH_OVERVIEW[overview] : row.sky && ENGLISH_SKY[row.sky]
          if (forecastEn) row.forecastEn = forecastEn
          found.set(key, row)
        })
      }
    }
  })
  return [...found.values()]
}

/** 降水確率がこれ以上（%）なら、雨か雪にする（気象庁の「傘を持つ目安」としてよく使われる 50%） */
export const WET_POP = 50

const SKY_BY_DIGIT: Record<string, Sky> = { '1': 'sunny', '2': 'cloudy', '3': 'rain', '4': 'snow' }

/**
 * 晴れ・くもり・雨の記号のうち、雪がまじるもの（気象庁の天気予報の記号：x04 一時雪、x05 時々雪、x15〜x17 のち雪、
 * 303 雨時々雪、309 雨一時雪、314 雨後時々雪、315 雨後雪）。週間予報には文がないので、雨か雪かを記号で分ける
 */
const SNOWY_CODES = new Set(['104', '105', '115', '116', '117', '204', '205', '215', '216', '217', '303', '309', '314', '315'])

/** 天気の芯（記号の先頭の 1 桁、なければ文の書き出し）と、降るなら雨か雪か。どちらも決まらなければ null */
export interface SkyParts {
  main: Sky
  wet: 'rain' | 'snow'
  /** 文に雨か雪が出てくる（降水確率がないときに、降りそうと見る） */
  mentionsWet: boolean
}

export function skyParts(code: string, text: string): SkyParts | null {
  const main =
    SKY_BY_DIGIT[/^\d{3}$/.test(code) ? code.charAt(0) : ''] ??
    (text.startsWith('晴') ? 'sunny' : /^(くもり|曇)/.test(text) ? 'cloudy' : text.startsWith('雨') ? 'rain' : text.startsWith('雪') ? 'snow' : null)
  if (!main) return null
  // 雪がまじるなら雪にする（雪だるまのほうが、旅の支度の目安として目立つため）
  const snowy = main === 'snow' || SNOWY_CODES.has(code) || text.includes('雪')
  return { main, wet: snowy ? 'snow' : 'rain', mentionsWet: main === 'rain' || main === 'snow' || /[雨雪]/.test(text) }
}

/**
 * 1 日の天気。降水確率（6 時間ごとの最大か、週間の 1 日の値）が WET_POP 以上なら雨か雪、下なら記号のとおり（記号が雨・雪ならそのまま）。
 * 降水確率がないときは、文に雨か雪が出てくれば雨か雪にする（降りそうなら傘を出す。Takana の依頼、2026-11-22）
 */
export function daySky(parts: SkyParts, blocks: readonly PopBlock[] | undefined, daily: number | undefined): Sky {
  const pop = blocks?.length ? Math.max(...blocks.map((block) => block.pop)) : daily
  if (pop === undefined) return parts.mentionsWet ? parts.wet : parts.main
  // 記号が雨か雪の日は、確率が低めでも記号を信じる（雨か雪のどちらかは parts.wet）
  return pop >= WET_POP || parts.main === 'rain' || parts.main === 'snow' ? parts.wet : parts.main
}

/** 6 時間ごとの天気。その時間の降水確率が WET_POP 以上なら雨か雪。下なら記号のとおりで、雨か雪の日の降らない時間はくもり */
export function blockSky(parts: SkyParts, pop: number): Sky {
  if (pop >= WET_POP) return parts.wet
  return parts.main === 'rain' || parts.main === 'snow' ? 'cloudy' : parts.main
}

/** 6 時間ごとの降水確率。hour は区切りの始まりの時（0、6、12、18） */
export interface PopBlock {
  hour: number
  pop: number
}

const popValue = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return undefined
  const pop = Number(value)
  return pop <= 100 ? pop : undefined
}

/** 予報区と日ごとの降水確率。短期は 6 時間ごと（blocks）、週間は 1 日の値（daily） */
function parsePops(reports: unknown[]): Map<string, { blocks: PopBlock[]; daily?: number }> {
  const pops = new Map<string, { blocks: PopBlock[]; daily?: number }>()
  reports.forEach((report, reportIndex) => {
    for (const series of list(field(report, 'timeSeries'))) {
      const times = list(field(series, 'timeDefines'))
      for (const area of list(field(series, 'areas'))) {
        const name = field(field(area, 'area'), 'name')
        const values = list(field(area, 'pops'))
        if (typeof name !== 'string' || values.length === 0) continue
        times.forEach((time, index) => {
          const date = jstDate(time)
          const pop = popValue(values[index])
          if (!date || pop === undefined) return
          const key = `${name}\n${date}`
          const entry = pops.get(key) ?? { blocks: [] }
          if (reportIndex === 0) {
            const hour = /T(\d{2}):/.exec(String(time))
            if (hour) entry.blocks.push({ hour: Number(hour[1]), pop })
          } else if (entry.daily === undefined) {
            entry.daily = pop
          }
          pops.set(key, entry)
        })
      }
    }
  })
  return pops
}

/**
 * 府県ごとの予報を、旅の予定日と今日に合わせて絞り、しおりの形にする。
 * reports は府県の名前ではなく予報区のコードで引く。取れなかった府県（null）は出さない（その府県だけ抜ける）
 */
export function assembleForecasts(input: {
  prefectures: readonly string[]
  reports: ReadonlyMap<string, unknown>
  startDate: string
  endDate: string | null
  today: string
}): PrefectureForecast[] {
  const last = input.endDate ?? input.startDate
  const rows = input.prefectures.flatMap((prefecture) =>
    officeCodesOf(prefecture).flatMap((code) => parseOfficeForecasts(input.reports.get(code)))
      .filter((row) => row.date >= input.today && row.date >= input.startDate && row.date <= last)
      .map((row): PrefectureForecast => ({ prefecture, ...row })),
  )
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
