import { useState } from 'react'
import { today, translate as t } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import { calendarMonth, shiftMonth, WEEKDAYS } from '../model/calendar'
import styles from './TripCalendar.module.css'

interface Props {
  /** 選んだ行く日（まだなら null） */
  start: string | null
  /** 選んだ帰る日（日帰り・まだなら null） */
  end: string | null
  onPick: (date: string) => void
}

const BAND_CLASS = { full: styles.bandFull, right: styles.bandRight, left: styles.bandLeft }
const MONTH_FORMAT = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const DAY_FORMAT = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' })
const WEEKDAYS_ENGLISH = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * 日程を選ぶカレンダー（旅をつくる画面の「いつ行く？」と、旅の設定の日程）。1 回目に押した日が行く日、2 回目が帰る日で、あいだを帯でつなぐ。
 * 今日より前の日は押せない。月は左右の矢印で送る（今月より前には戻れない）。日の並びと状態は model/calendar.ts
 */
export function TripCalendar({ start, end, onPick }: Props) {
  const now = today()
  const first = start ?? now
  const [view, setView] = useState({ year: Number(first.slice(0, 4)), month: Number(first.slice(5, 7)) - 1 })
  const { lead, days, atFirstMonth } = calendarMonth(view.year, view.month, start, end, now)

  return (
    <div className={styles.calendar}>
      <div className={styles.head}>
        <button type="button" className={styles.nav} aria-label={t('前の月', 'Previous month')} disabled={atFirstMonth} onClick={() => setView(shiftMonth(view, -1))}>
          <Icon name="back" size={20} />
        </button>
        <b aria-live="polite">
          {t(`${view.year}年 ${view.month + 1}月`, MONTH_FORMAT.format(Date.UTC(view.year, view.month, 1)))}
        </b>
        <button type="button" className={styles.nav} aria-label={t('次の月', 'Next month')} onClick={() => setView(shiftMonth(view, 1))}>
          <Icon name="chevron" size={20} />
        </button>
      </div>
      <div className={styles.week} aria-hidden="true">
        {WEEKDAYS.map((day, index) => (
          <span key={day}>{t(day, WEEKDAYS_ENGLISH[index])}</span>
        ))}
      </div>
      <div className={styles.days}>
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {days.map((day) => (
          <span key={day.date} className={styles.cell}>
            {day.band && <i className={`${styles.band} ${BAND_CLASS[day.band]}`} />}
            <button
              type="button"
              className={[styles.day, day.chosen ? styles.chosen : '', day.isToday ? styles.today : '', day.weekday === 0 ? styles.sun : day.weekday === 6 ? styles.sat : ''].join(' ')}
              aria-label={t(`${view.year}年${view.month + 1}月${day.day}日（${WEEKDAYS[day.weekday]}）`, DAY_FORMAT.format(Date.UTC(view.year, view.month, day.day)))}
              aria-pressed={day.chosen || day.inside}
              disabled={day.past}
              onClick={() => onPick(day.date)}
            >
              {day.day}
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
