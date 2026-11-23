// 時刻が決まったイベント（花火大会、見学会）の決め（純粋。I/O なし）。企画書の合意前の案「時刻が決まったイベント（2026-11-21）」、#581。
// 画面側の同じ型と計算は web/src/entities/pin/model/types.ts と web/src/entities/route/model/events.ts。片方を変えたら、同じ PR でもう片方も合わせる

/** イベントの種類。fireworks：花火大会。tour：見学会 */
export type EventKind = 'fireworks' | 'tour'

/**
 * ピンに付ける、イベントの開催の情報（Pin.event）。イベントの候補のピンにだけある。
 * しおりでは、着く時刻（start − leadMinutes）と出る時刻（end）を固定し、開催日の日に置く（domain/routePlan.ts の buildPlan）
 */
export interface PinEvent {
  kind: EventKind
  /** 開催日（YYYY-MM-DD） */
  date: string
  /** 始まり（0 時からの分） */
  start: number
  /** 終わり（0 時からの分）。start より後 */
  end: number
  /** 始まりの何分前に着いておくか（花火は場所取り、見学会は受付） */
  leadMinutes: number
  /** 出典の名前（見本の一覧なら「見本のイベントの一覧」） */
  source: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MINUTES = 24 * 60

/** Firestore から読んだ値が、決まった形のイベントか */
export function isPinEvent(value: unknown): value is PinEvent {
  const event = value as Partial<PinEvent> | null | undefined
  const minutes = (item: unknown) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < DAY_MINUTES
  return (
    !!event
    && (event.kind === 'fireworks' || event.kind === 'tour')
    && typeof event.date === 'string'
    && DATE.test(event.date)
    && minutes(event.start)
    && minutes(event.end)
    && (event.end as number) > (event.start as number)
    && minutes(event.leadMinutes)
    && (event.start as number) - (event.leadMinutes as number) >= 0
    && typeof event.source === 'string'
  )
}

const utc = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** startDate を 1 日目としたときの、date が何日目か（前の日なら 0 以下） */
export function dayNumberOf(date: string, startDate: string): number {
  return Math.round((utc(date) - utc(startDate)) / 86_400_000) + 1
}

/** startDate から days 日ぶんの日付（YYYY-MM-DD） */
export function datesOf(startDate: string, days: number): string[] {
  const start = utc(startDate)
  return Array.from({ length: Math.max(0, days) }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10))
}

/** date の曜日（0 が日曜） */
export function weekdayOf(date: string): number {
  return new Date(utc(date)).getUTCDay()
}

/** しおりでのイベントの枠。day は何日目か、arrive は着く時刻、leave は出る時刻（どちらも 0 時からの分） */
export interface EventWindow {
  day: number
  arrive: number
  leave: number
}

/** 旅の中でのイベントの枠。開催日が旅の日程（startDate から days 日）の外なら null */
export function eventWindow(event: PinEvent, startDate: string, days: number): EventWindow | null {
  const day = dayNumberOf(event.date, startDate)
  if (day < 1 || day > days) return null
  return { day, arrive: event.start - event.leadMinutes, leave: event.end }
}

/**
 * しおりを自動で組むとき（建った場所を差し込む位置を選ぶとき）に、イベントの前にとる余裕（分）。
 * 移動が長いほど遅れやすいので、移動時間の 3 割（5 分きざみに切り上げ）と 30 分の大きいほう。
 * 人が時刻を直すときは使わない（重なるときだけ確かめる。Takana の決定、2026-11-21）。数字は実装した AI が仮に選んだ
 */
export function eventBufferMinutes(moveMinutes: number): number {
  return Math.max(30, Math.ceil((Math.max(0, moveMinutes) * 0.3) / 5) * 5)
}
