import { recall, remember } from './storage'

// さっきまで開いていた旅。ホームの一覧で「いま開いている」の目印を付けるために、この端末に覚えておく。
const KEY = 'lastTripId'

export function rememberLastTrip(tripId: string): void {
  remember(KEY, tripId)
}

export function recallLastTrip(): string | null {
  return recall(KEY)
}
