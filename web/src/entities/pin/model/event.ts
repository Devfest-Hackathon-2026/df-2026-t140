import { clockLabel, monthDayLabel, translate } from '@/shared/lib'
import type { PinEvent } from './types'

/** イベントの開催の日時（「11/28（土） 19:30〜20:30」） */
export function eventTimeLabel(event: Pick<PinEvent, 'date' | 'start' | 'end'>): string {
  return `${monthDayLabel(event.date)} ${clockLabel(event.start)}${translate('〜', '–')}${clockLabel(event.end)}`
}
