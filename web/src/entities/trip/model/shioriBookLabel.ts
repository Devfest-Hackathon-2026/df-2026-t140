import { appLanguage, dateRangeLabel, monthDayLabel, nightsLabel } from '@/shared/lib'
import type { ShioriBook } from './shioriBook'

/** しおりビューと PDF の日程の表示：「11/21（土）〜11/22（日）・1泊2日」。日帰りは「11/21（土）・日帰り」 */
export function shioriBookDateText(book: Pick<ShioriBook, 'startDate' | 'endDate'>): string {
  const nights = nightsLabel(book.startDate, book.endDate)
  if (appLanguage === 'en') return `${dateRangeLabel(book.startDate, book.endDate)} · ${nights}`
  if (!book.endDate || book.endDate === book.startDate) return `${monthDayLabel(book.startDate)}・${nights}`
  return `${monthDayLabel(book.startDate)}〜${monthDayLabel(book.endDate)}・${nights}`
}
