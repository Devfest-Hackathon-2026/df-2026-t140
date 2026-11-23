// 日程を選ぶカレンダー（ui/TripCalendar。旅をつくる画面の「いつ行く？」と、旅の設定の日程）に並べる日と、それぞれの日の状態。画面の部品から分けた計算

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

const pad = (value: number) => String(value).padStart(2, '0')

/** 行く日から帰る日までをつなぐ帯の形。まん中の日は全部、行く日は右半分、帰る日は左半分 */
export type CalendarBand = 'full' | 'right' | 'left' | null

export interface CalendarDay {
  day: number
  /** YYYY-MM-DD */
  date: string
  /** 0 が日曜 */
  weekday: number
  /** 行く日か帰る日 */
  chosen: boolean
  /** 行く日と帰る日のあいだ */
  inside: boolean
  band: CalendarBand
  isToday: boolean
  /** 今日より前（押せない） */
  past: boolean
}

export interface CalendarMonth {
  /** 月の初めの前にあける空きの数（日曜から数える） */
  lead: number
  days: CalendarDay[]
  /** 今月なら true（前の月へ戻れない） */
  atFirstMonth: boolean
}

/** その月（month は 0 始まり）のカレンダー。start と end は選んだ行く日と帰る日（まだなら null）、today は今日 */
export function calendarMonth(year: number, month: number, start: string | null, end: string | null, today: string): CalendarMonth {
  const lead = new Date(year, month, 1).getDay()
  const count = new Date(year, month + 1, 0).getDate()
  const spans = start !== null && end !== null && end !== start
  const days = Array.from({ length: count }, (_, i): CalendarDay => {
    const day = i + 1
    const date = `${year}-${pad(month + 1)}-${pad(day)}`
    const inside = spans && date > start && date < end
    const band: CalendarBand = inside ? 'full' : spans && date === start ? 'right' : spans && date === end ? 'left' : null
    return { day, date, weekday: (lead + i) % 7, chosen: date === start || date === end, inside, band, isToday: date === today, past: date < today }
  })
  return { lead, days, atFirstMonth: `${year}-${pad(month + 1)}` <= today.slice(0, 7) }
}

/** 月を送る（delta は -1 か 1）。年をまたぐ */
export function shiftMonth(view: { year: number; month: number }, delta: number): { year: number; month: number } {
  const month = view.month + delta
  return { year: view.year + Math.floor(month / 12), month: ((month % 12) + 12) % 12 }
}

/** カレンダーで選んでいる日程。awaitingEnd は、行く日を押して帰る日を待っているあいだ */
export interface DateRange {
  start: string
  /** 日帰りなら null */
  end: string | null
  awaitingEnd: boolean
}

/**
 * カレンダーで日を押したときの、次の日程。帰る日を待っていないとき（と、行く日より前を押したとき）は、押した日を行く日にして帰る日を待つ。
 * 待っているときは、押した日を帰る日にする（行く日と同じ日なら日帰り）。旅をつくる画面の pickQuizDate と同じ決め
 */
export function pickDateRange(range: DateRange, date: string): DateRange {
  if (!range.awaitingEnd || date < range.start) return { start: date, end: null, awaitingEnd: true }
  return { start: range.start, end: date === range.start ? null : date, awaitingEnd: false }
}
