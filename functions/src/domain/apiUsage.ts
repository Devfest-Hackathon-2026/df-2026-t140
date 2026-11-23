// Maps 系の API を呼んだ回数を数える決まりと、画面に出す使用量の形。純粋な判断だけを置く。
// 数える・読む I/O は adapters/apiUsage.ts と features/api-usage。
//
// これはデバッグ用の表示のための数で、上限で止めるのは Google Cloud の割り当て（docs/process/setup.md の「課金を避ける上限」）。
// Gemini（vertex）の回数は、止めるための数として別に数えている（domain/geminiBudget.ts の usage/flash、usage/argon）。

import { ARGON_DAILY_MAX, ARGON_TOTAL_MAX, FLASH_TOTAL_MAX } from './geminiBudget'

/** 回数を数える API。画面に出す順に並べる */
export const COUNTED_APIS = ['placesSearch', 'placesDetails', 'placesPhoto', 'routes', 'knowledgeGraph', 'mapsLoad'] as const
export type CountedApi = (typeof COUNTED_APIS)[number]

/** 回数を記録するドキュメント（usage コレクションの中）。端末からは読み書きできない（firestore.rules） */
export const API_USAGE_DOC: Record<CountedApi, string> = {
  placesSearch: 'places-search',
  placesDetails: 'places-details',
  placesPhoto: 'places-photo',
  routes: 'routes',
  knowledgeGraph: 'knowledge-graph',
  mapsLoad: 'maps-load',
}

/**
 * 1 日の上限。Google Cloud にかけた割り当てと同じ数（docs/process/setup.md の「課金を避ける上限」）。
 * 割り当てを変えたら、ここも直す。写真は使う設定のときだけ 100 回（使わない設定では 0 回。features/api-usage が決める）
 * Places は 2026-11-23 に口コミ 200 回、写真 100 回に上げた（かめの決定、Youkin06 が設定。テキスト検索は 2026-11-08 から 150 回）
 */
export const API_DAILY_MAX: Record<CountedApi, number> = {
  placesSearch: 150,
  placesDetails: 200,
  placesPhoto: 100,
  routes: 30,
  // 無料。1 日 10 万回まで（https://developers.google.com/knowledge-graph/reference/rest/v1/usage-limits）
  knowledgeGraph: 100_000,
  mapsLoad: 300,
}

/**
 * Maps 系の回数を数える日付（米国太平洋時間の YYYY-MM-DD）。
 * Google Cloud の 1 日の割り当ては太平洋時間の 0 時で戻るので、それに合わせる（日本時間の 16 時か 17 時）
 */
export function apiUsageDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** usage/<API> の記録。読んだ生の値なので型は決めない */
export interface ApiUsageRecord {
  day?: unknown
  dayCount?: unknown
}

/** 記録のうち、今日の回数。記録がない・日付が今日でなければ 0。壊れていれば null（画面では「わからない」と出す） */
export function dailyCountOf(record: ApiUsageRecord | undefined, today: string): number | null {
  if (!record || record.day === undefined || record.day === null) return 0
  if (typeof record.day !== 'string') return null
  if (record.day !== today) return 0
  const count = record.dayCount
  if (count === undefined || count === null) return 0
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null
}

/** 1 回数えたあとの記録。日付が変わっていれば 1 から。壊れた記録も 1 から数え直す（止めるための数ではないので） */
export function countedRecord(record: ApiUsageRecord | undefined, today: string): { day: string; dayCount: number } {
  return { day: today, dayCount: (dailyCountOf(record, today) ?? 0) + 1 }
}

/** 画面に出す 1 行の種類。Gemini の 3 つと、数える API */
export type ApiUsageKey = 'flash' | 'argonDay' | 'argonTotal' | CountedApi

export interface ApiUsageRow {
  key: ApiUsageKey
  /** 区切り。day は 1 日（Maps 系は太平洋時間、Argon は日本時間）、total は累計 */
  period: 'day' | 'total'
  /** 使った回数。記録が壊れていれば null */
  used: number | null
  /** 上限。0 は使わない設定 */
  max: number
}

/** 記録のうち、累計の回数。記録がなければ 0、壊れていれば null */
function totalCountOf(value: unknown): number | null {
  if (value === undefined || value === null) return 0
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * 読んだ記録から、画面に出す行を作る。
 * argonToday は日本時間の日付（geminiBudget の budgetDay）、apiToday は太平洋時間の日付（apiUsageDay）
 */
export function apiUsageRows(input: {
  flash: { count?: unknown } | undefined
  argon: ApiUsageRecord & { count?: unknown } | undefined
  apis: Partial<Record<CountedApi, ApiUsageRecord>>
  argonToday: string
  apiToday: string
  photosEnabled: boolean
}): ApiUsageRow[] {
  const gemini: ApiUsageRow[] = [
    { key: 'flash', period: 'total', used: totalCountOf(input.flash?.count), max: FLASH_TOTAL_MAX },
    { key: 'argonDay', period: 'day', used: dailyCountOf(input.argon, input.argonToday), max: ARGON_DAILY_MAX },
    { key: 'argonTotal', period: 'total', used: totalCountOf(input.argon?.count), max: ARGON_TOTAL_MAX },
  ]
  const apis = COUNTED_APIS.map(
    (api): ApiUsageRow => ({
      key: api,
      period: 'day',
      used: dailyCountOf(input.apis[api], input.apiToday),
      max: api === 'placesPhoto' && !input.photosEnabled ? 0 : API_DAILY_MAX[api],
    }),
  )
  return [...gemini, ...apis]
}
