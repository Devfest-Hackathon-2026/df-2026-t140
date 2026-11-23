// 日付は YYYY-MM-DD の文字で持つ（時差でずれないように、その土地の日付として扱う）。
import { appLanguage, translate } from './language.ts'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const englishDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', weekday: 'short' })
const englishShortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const englishAgo = new Intl.RelativeTimeFormat('en', { style: 'short' })

function toLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** 今日の日付（端末の時刻で） */
export function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 泊数。終了日なし（null）は日帰りで 0 */
export function nights(startDate: string, endDate: string | null): number {
  if (!endDate) return 0
  const days = Math.round((toLocalDate(endDate).getTime() - toLocalDate(startDate).getTime()) / 86_400_000)
  return Math.max(days, 0)
}

/** 「日帰り」「1泊2日」。英語は日数だけ（「1 day」「2 days」。Takana の希望、2026-11-23） */
export function nightsLabel(startDate: string, endDate: string | null): string {
  const count = nights(startDate, endDate)
  if (count === 0) return translate('日帰り', '1 day')
  return translate(`${count}泊${count + 1}日`, `${count + 1} days`)
}

/** 「11/21（土）」 */
export function monthDayLabel(date: string): string {
  const value = toLocalDate(date)
  if (appLanguage === 'en') return Number.isNaN(value.getTime()) ? date : englishDate.format(value)
  return `${value.getMonth() + 1}/${value.getDate()}（${WEEKDAYS[value.getDay()]}）`
}

/** その日から days 日あとの日付（YYYY-MM-DD） */
export function addDays(date: string, days: number): string {
  const value = toLocalDate(date)
  value.setDate(value.getDate() + days)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** 「たった今」「3分前」「2時間前」「3日前」 */
export function timeAgo(then: Date, now: Date): string {
  const seconds = Math.max((now.getTime() - then.getTime()) / 1000, 0)
  if (seconds < 60) return translate('たった今', 'just now')
  const [value, suffix, unit] = seconds < 3600
    ? [Math.floor(seconds / 60), '分', 'minute'] as const
    : seconds < 86_400
      ? [Math.floor(seconds / 3600), '時間', 'hour'] as const
      : [Math.floor(seconds / 86_400), '日', 'day'] as const
  return translate(`${value}${suffix}前`, englishAgo.format(-value, unit))
}

/** 日程の短い表示：「11/21–22」「11/30–12/1」。終了日なし（日帰り）は「11/21」。しおり（S11）としおりビュー（S14）の上の部分に出す */
export function dateRangeLabel(startDate: string, endDate: string | null): string {
  if (appLanguage === 'en') {
    const start = toLocalDate(startDate)
    if (Number.isNaN(start.getTime())) return startDate
    const first = englishShortDate.format(start)
    if (!endDate || endDate === startDate) return first
    const end = toLocalDate(endDate)
    return Number.isNaN(end.getTime()) ? first : `${first}–${englishShortDate.format(end)}`
  }
  const [, startMonth, startDay] = startDate.split('-').map(Number)
  const start = `${startMonth}/${startDay}`
  if (!endDate || endDate === startDate) return start
  const [, endMonth, endDay] = endDate.split('-').map(Number)
  return endMonth === startMonth ? `${start}–${endDay}` : `${start}–${endMonth}/${endDay}`
}
