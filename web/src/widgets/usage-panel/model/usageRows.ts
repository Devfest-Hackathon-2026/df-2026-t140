// 使用量の 1 行を、画面に出す形（名前、区切り、「n / 上限」、棒の長さと色）にする。純粋な関数だけを置く。

/** Functions が返す 1 行（functions/src/domain/apiUsage.ts の ApiUsageRow と同じ形） */
export interface ApiUsageRow {
  key: string
  period: 'day' | 'total'
  used: number | null
  max: number
}

/** 棒の色の段階。ok は余裕あり、warn は上限の 8 割から、full は上限に達した */
export type UsageTone = 'ok' | 'warn' | 'full'

export interface UsageView {
  key: string
  name: string
  period: string
  /** 「12 / 30」。上限が 0 なら「使わない設定」、記録が壊れていれば「? / 30」 */
  count: string
  /** 棒の長さ（0〜1） */
  ratio: number
  tone: UsageTone
  /** 1 日の回数が 0 に戻るまで（「あと 7h 23m で 0 に戻る」）。累計と、使わない設定では null */
  reset: string | null
}

/** API の名前。知らない key はそのまま出す */
const NAMES: Record<string, string> = {
  flash: 'Gemini Flash',
  argonDay: 'Gemini Argon',
  argonTotal: 'Gemini Argon',
  placesSearch: 'Places テキスト検索',
  placesDetails: 'Places 詳細（口コミ）',
  placesPhoto: 'Places 写真',
  routes: 'Routes',
  knowledgeGraph: 'Knowledge Graph',
  mapsLoad: '地図の読み込み',
}

/** この割合から、棒を注意の色にする */
export const WARN_RATIO = 0.8

/**
 * 1 日の回数を区切る時間帯。Argon は自分たちの上限なので日本時間（functions の budgetDay）、
 * それ以外は Google Cloud の割り当てに合わせて米国太平洋時間（functions の apiUsageDay）
 */
export function resetTimeZone(key: string): string {
  return key === 'argonDay' ? 'Asia/Tokyo' : 'America/Los_Angeles'
}

const DAY_SECONDS = 24 * 60 * 60

/**
 * その時間帯の次の 0 時までの残り（「あと 7h 23m」）。分は切り上げる（0 時ちょうどは 24h 0m）。
 * 夏時間が切り替わる日は 1 時間ずれるが、目安なので許す
 */
export function untilReset(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(now)
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0)
  const elapsed = part('hour') * 3600 + part('minute') * 60 + part('second')
  const minutes = Math.ceil((DAY_SECONDS - elapsed) / 60)
  return `あと ${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function usageView(row: ApiUsageRow, now: Date): UsageView {
  const name = NAMES[row.key] ?? row.key
  const period = row.period === 'day' ? '今日' : '累計'
  const max = row.max.toLocaleString('ja-JP')
  if (row.max <= 0) return { key: row.key, name, period, count: '使わない設定', ratio: 0, tone: 'ok', reset: null }
  const reset = row.period === 'day' ? `${untilReset(now, resetTimeZone(row.key))} で 0 に戻る` : null
  if (row.used === null) return { key: row.key, name, period, count: `? / ${max}`, ratio: 0, tone: 'warn', reset }
  const ratio = Math.min(1, Math.max(0, row.used / row.max))
  const tone: UsageTone = row.used >= row.max ? 'full' : ratio >= WARN_RATIO ? 'warn' : 'ok'
  return { key: row.key, name, period, count: `${row.used.toLocaleString('ja-JP')} / ${max}`, ratio, tone, reset }
}
