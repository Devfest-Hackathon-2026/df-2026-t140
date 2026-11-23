import type { CalendarEventDraft } from '../lib/events'

// Google Calendar API（events）を、押した人のアクセストークンで端末から呼ぶ。
// 入れる先は、その人のメインのカレンダー。トークンはどこにも保存しない（shared/api/account.ts）。

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** 入れられなかった理由。expired：許可が切れた。denied：許可がない・Calendar API が使えない。failed：そのほか */
export class CalendarProblem extends Error {
  readonly reason: 'expired' | 'denied' | 'failed'

  constructor(reason: 'expired' | 'denied' | 'failed') {
    super(`Calendar API refused: ${reason}`)
    this.reason = reason
  }
}

/** 回数の上限で断られたときの理由（403 でも、許可がないのとは違う。時間をおけば入れられる） */
const LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']

async function reasonOf(response: Response): Promise<CalendarProblem['reason']> {
  if (response.status === 401) return 'expired'
  if (response.status !== 403) return 'failed'
  const body = (await response.json().catch(() => null)) as { error?: { errors?: { reason?: string }[] } } | null
  const reason = body?.error?.errors?.[0]?.reason
  return reason && LIMIT_REASONS.includes(reason) ? 'failed' : 'denied'
}

/** 画面に出す値を外して、Calendar API に渡す形にする */
function bodyOf(event: CalendarEventDraft) {
  const { id, summary, description, start, end } = event
  return { id, summary, description, start, end, status: 'confirmed' }
}

/**
 * 1 件の予定を入れる。同じ ID の予定がもうある（前に入れた。消したあとも ID は残る）ときは、
 * 同じ中身で上書きする（消した予定も元に戻る）。だから何度押しても予定は増えない
 */
async function putEvent(token: string, event: CalendarEventDraft): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const body = JSON.stringify(bodyOf(event))
  const inserted = await fetch(EVENTS_URL, { method: 'POST', headers, body })
  if (inserted.ok) return
  if (inserted.status !== 409) throw new CalendarProblem(await reasonOf(inserted))
  const updated = await fetch(`${EVENTS_URL}/${encodeURIComponent(event.id)}`, { method: 'PUT', headers, body })
  if (!updated.ok) throw new CalendarProblem(await reasonOf(updated))
}

/**
 * 予定を順に入れる。1 件入れるたびに onProgress（入れた数）を呼ぶ。
 * sample のとき（手元の Emulator）は Calendar API を呼ばず、入れたことにして進める（本物のトークンがないため）
 */
export async function insertCalendarEvents(
  token: string,
  events: readonly CalendarEventDraft[],
  onProgress: (done: number) => void,
  sample: boolean,
): Promise<void> {
  for (const [index, event] of events.entries()) {
    if (sample) await new Promise((resolve) => setTimeout(resolve, 150))
    else await putEvent(token, event)
    onProgress(index + 1)
  }
}
