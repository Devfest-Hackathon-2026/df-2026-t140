// 日付は YYYY-MM-DD の文字で持つ（時差でずれないように、その土地の日付として扱う）。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

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

/** 「日帰り」「1泊2日」 */
export function nightsLabel(startDate: string, endDate: string | null): string {
  const count = nights(startDate, endDate)
  return count === 0 ? '日帰り' : `${count}泊${count + 1}日`
}

/** 「11/21（土）」 */
export function monthDayLabel(date: string): string {
  const value = toLocalDate(date)
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
  if (seconds < 60) return 'たった今'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}時間前`
  return `${Math.floor(seconds / 86_400)}日前`
}
