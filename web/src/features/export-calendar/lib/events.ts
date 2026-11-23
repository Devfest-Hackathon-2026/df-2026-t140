import type { ShioriDay } from '@/entities/trip'
import { translate } from '../../../shared/lib/language.ts'

// しおりから、Google カレンダーに入れる予定を作る（純粋な決め）。
// scripts/web.test.mjs が Node でそのまま読むので、型のほかは別名（@/）の import を使わない。

/** 予定の時刻のタイムゾーン。旅は日本の中なので、日本時間で入れる */
export const TRIP_TIME_ZONE = 'Asia/Tokyo'

/** 滞在の長さが 0 の行（集合場所など）の予定の長さ（分） */
const SHORT_EVENT_MINUTES = 15

/** Google カレンダーに入れる 1 件（Calendar API の events の形に、画面に出す値を足したもの） */
export interface CalendarEventDraft {
  /** 予定の ID。旅と行から決まった形で作る（同じ予定を 2 回入れない）。使える字は 0-9 と a-v */
  id: string
  summary: string
  description: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  /** 画面に出す日付（YYYY-MM-DD）と時刻（HH:MM） */
  date: string
  startTime: string
  endTime: string
  /** 場所にいる予定（集合場所も）か、場所から場所への移動の予定か。画面で移動を控えめに出すのに使う（Calendar には送らない） */
  kind: 'stay' | 'move'
}

/** 32 ビットの FNV-1a を 16 進の 8 文字にする（予定の ID に使う。16 進の字は Calendar の ID に使える） */
function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const pad = (value: number) => String(value).padStart(2, '0')

/** その日の 0 時から minutes 分の日時（日をまたぐ時刻も正しい日付にする） */
function dateTimeAt(date: string, minutes: number): { date: string; time: string; dateTime: string } {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day, 0, minutes))
  const ymd = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`
  return { date: ymd, time, dateTime: `${ymd}T${time}:00` }
}

/** 「10:40」を 0 時からの分にする。形が違えば null */
function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * しおりの行を、Google カレンダーの予定にする（場所ごとに 1 件。Takana の決定、2026-11-18）。
 * days は entities/trip の shioriBookDays の結果（集合場所の見分けと日付は、画面と PDF と同じ決めを使う）。
 * - 予定の長さは、時刻から滞在の長さまで。集合場所は、集合時間から出発時間まで。滞在が 0 のほかの行は 15 分にする
 * - 時刻の分からない行（出発地の位置が分からない旅の集合場所など）は入れない
 * - 説明に、誰のやりたいことか（やりたいことと名前）と、どの旅のしおりかを書く
 * - ID は旅の ID と、しおり全体での行の番号から作る。同じ旅の同じ行は、何度入れても同じ ID になる
 * - 場所から場所への移動も、1 件ずつ予定にする（moveEvent。Takana の依頼、2026-11-22）。ゆとり（移動を終えてから次の場所の時刻までの空き）には何も入れない
 */
export function calendarEvents(days: readonly ShioriDay[], title: string, tripId: string): CalendarEventDraft[] {
  const prefix = `tabimusubi${fnv(tripId)}`
  // 移動の予定の ID は、場所の予定と混ざらないよう、別の頭にする（同じ行の番号でも違う ID になる）
  const movePrefix = `tabimusubi${fnv(`move:${tripId}`)}`
  const rows = days.flatMap((day) => day.rows.map((row) => ({ date: day.date, row })))
  const events: CalendarEventDraft[] = []
  let index = -1
  for (const day of days) {
    for (const row of day.rows) {
      index += 1
      const departMinutes = minutesOf(row.time)
      if (departMinutes === null) continue
      // 集合場所は、集合時間から出発時間まで（集合時間が出発より遅いときは、出発から 15 分）
      const meetMinutes = row.meetTime ? minutesOf(row.meetTime) : null
      const fromMeet = meetMinutes !== null && meetMinutes < departMinutes
      const startMinutes = fromMeet ? meetMinutes : departMinutes
      const length = fromMeet ? departMinutes - meetMinutes : row.stayMinutes > 0 ? row.stayMinutes : SHORT_EVENT_MINUTES
      const start = dateTimeAt(day.date, startMinutes)
      const end = dateTimeAt(day.date, startMinutes + length)
      const wish = row.wishText
        ? translate(
            `「${row.wishText}」${row.wisher ? `（${row.wisher.name}のやりたいこと）` : ''}`,
            `“${row.wishText}”${row.wisher ? ` (${row.wisher.name}'s wish)` : ''}`,
          )
        : ''
      events.push({
        id: `${prefix}${index.toString(32)}`,
        summary: row.kind === 'origin' ? translate(`${row.name}に集合・出発`, `Meet and depart: ${row.name}`) : row.name,
        description: [wish, translate(`${title}のしおり（たびむすび）`, `${title} itinerary (Tabimusubi)`)].filter(Boolean).join('\n\n'),
        start: { dateTime: start.dateTime, timeZone: TRIP_TIME_ZONE },
        end: { dateTime: end.dateTime, timeZone: TRIP_TIME_ZONE },
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        kind: 'stay',
      })
      // この行を出て、次の行へ向かう移動
      const move = moveEvent(rows[index], rows[index + 1], title)
      if (move) events.push({ ...move, id: `${movePrefix}${index.toString(32)}` })
    }
  }
  return events
}

/** 日付の 0 時から数えた分を、基準の日（base）の 0 時から数えた分にする（日をまたぐ移動の計算のため） */
function minutesFrom(base: string, date: string, minutes: number): number {
  const day = (value: string) => {
    const [year, month, dayOfMonth] = value.split('-').map(Number)
    return Date.UTC(year, month - 1, dayOfMonth) / 86_400_000
  }
  return (day(date) - day(base)) * 24 * 60 + minutes
}

/**
 * 行（from）を出て、次の行（to）へ向かう移動の予定。移動の長さ（moveMinutesToNext）が分からない、0 分、次の行の時刻が分からないときは null。
 * - ふつうは、前の行を出る時刻（時刻＋滞在の長さ。集合場所は出発時間）から、移動の長さだけ。次の行の時刻までに余った時間（ゆとり）には何も入れない
 * - 出る日と着く日が違う移動（その日の最後の場所から、次の日の最初の場所へ）は、次の行に着く時刻で終わるようにする
 *   （しおりは、その日の最後の場所から次の日へ移るとき、次の日の始まりに出るとみなすため。宿に泊まったときは、宿を出るのが次の朝なので、出る時刻からでよい）
 * - 移動が次の行の時刻にかかるときは、次の行の時刻で切る（場所の予定と重ねない）
 */
function moveEvent(
  from: { date: string; row: ShioriDay['rows'][number] } | undefined,
  to: { date: string; row: ShioriDay['rows'][number] } | undefined,
  title: string,
): Omit<CalendarEventDraft, 'id'> | null {
  if (!from || !to) return null
  const moveMinutes = from.row.moveMinutesToNext
  const at = minutesOf(from.row.time)
  const arrive = minutesOf(to.row.time)
  if (!moveMinutes || moveMinutes <= 0 || at === null || arrive === null) return null
  const leave = at + (from.row.kind === 'origin' ? 0 : from.row.stayMinutes)
  const arriveAt = minutesFrom(from.date, to.date, arrive)
  const dayOf = (minutes: number) => Math.floor(minutes / (24 * 60))
  const startMinutes = dayOf(leave) === dayOf(arriveAt) ? leave : Math.max(leave, arriveAt - moveMinutes)
  const endMinutes = Math.min(startMinutes + moveMinutes, arriveAt)
  if (endMinutes <= startMinutes) return null
  const start = dateTimeAt(from.date, startMinutes)
  const end = dateTimeAt(from.date, endMinutes)
  return {
    summary: translate(`移動：${from.row.name} → ${to.row.name}`, `Travel: ${from.row.name} → ${to.row.name}`),
    description: translate(`${title}のしおり（たびむすび）`, `${title} itinerary (Tabimusubi)`),
    start: { dateTime: start.dateTime, timeZone: TRIP_TIME_ZONE },
    end: { dateTime: end.dateTime, timeZone: TRIP_TIME_ZONE },
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    kind: 'move',
  }
}

/** 予定を日ごとに分ける（日付の順） */
export function eventsByDate(events: readonly CalendarEventDraft[]): { date: string; events: CalendarEventDraft[] }[] {
  const days: { date: string; events: CalendarEventDraft[] }[] = []
  for (const event of events) {
    const last = days[days.length - 1]
    if (last?.date === event.date) last.events.push(event)
    else days.push({ date: event.date, events: [event] })
  }
  return days
}

/** 入れた予定の最初の日を開く、Google カレンダーの URL */
export function calendarDayUrl(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `https://calendar.google.com/calendar/r/day/${year}/${month}/${day}`
}
