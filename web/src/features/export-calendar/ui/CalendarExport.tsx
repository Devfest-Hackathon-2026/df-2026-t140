import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ShioriBook } from '@/entities/trip'
import { translate, monthDayLabel } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import { useCalendarExport } from '../model/useCalendarExport'
import styles from './CalendarExport.module.css'

interface Props {
  tripId: string
  book: ShioriBook | undefined
  /** メニューの項目を押した（メニューを閉じる） */
  onPicked: () => void
  /** メニューの項目のボタンの見た目（置く側が決める） */
  itemClassName: string
}

/**
 * 「Google カレンダーに入れる」。書き出しのメニューの項目と、押したあとに出る、入れる予定を確かめる画面。
 * 項目を押すと Google のポップアップでカレンダーの許可（連携していなければ連携も）をもらい、済んだら画面を出す
 */
export function CalendarExport({ tripId, book, onPicked, itemClassName }: Props) {
  const { phase, asking, events, days, calendarUrl, email, sample, start, send, close } = useCalendarExport(tripId, book)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const open = phase.kind !== 'closed'

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) {
      element.showModal()
      element.focus()
    }
    if (!open && element.open) element.close()
  }, [open])

  const sending = phase.kind === 'sending'

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={itemClassName}
        disabled={!book || asking || events.length === 0}
        onClick={() => {
          onPicked()
          void start()
        }}
      >
        <Icon name="calendar" />
        {asking ? translate('Google につないでいます…', "Connecting to Google…") : translate('Google カレンダーに入れる', "Add to Google Calendar")}
      </button>

      {/* 画面は、メニュー（role="menu"）の外に出す。メニューの中は項目だけにする */}
      {createPortal(
      <dialog
        ref={dialog}
        className={styles.dialog}
        tabIndex={-1}
        aria-labelledby={`calendar-export-${tripId}`}
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        <div className={styles.body}>
          <h2 id={`calendar-export-${tripId}`} className={styles.title}>
            <Icon name="calendar" />
            {translate('Google カレンダーに入れる', "Add to Google Calendar")}
          </h2>

          {phase.kind === 'sent' ? (
            <>
              <p className={styles.lead}>
                {sample
                  ? translate(`手元（開発環境）の見本なので、本物のカレンダーには入れていません。本番では、ここで ${events.length} 件の予定が入ります。`, `This is a preview. In the live app, ${events.length} events would be added to your calendar.`)
                  : translate(`${events.length} 件の予定を入れました。`, `Added ${events.length} ${events.length === 1 ? 'event' : 'events'}.`)}
              </p>
              {!sample && calendarUrl && (
                <a className={styles.open} href={calendarUrl} target="_blank" rel="noreferrer">
                  <Icon name="external" size={18} />
                  {translate('Google カレンダーで見る', 'Open in Google Calendar')}
                </a>
              )}
              <Button block onClick={close}>
                {translate('閉じる', "Close")}
              </Button>
            </>
          ) : (
            <>
              <p className={styles.lead}>
                {translate(`${email ? `${email} の` : 'あなたの'}カレンダーに、次の ${events.length} 件の予定を入れます。`, `Add these ${events.length} ${events.length === 1 ? 'event' : 'events'} to ${email ? `${email}'s calendar` : 'your calendar'}.`)}
              </p>
              {sample && <p className={styles.sample}>{translate('手元（開発環境）の見本です。本物のカレンダーには入れません。', "This is a development preview. No events will be added to your calendar.")}</p>}
              <div className={styles.list}>
                {days.map((day) => (
                  <section key={day.date} className={styles.day}>
                    <h3 className={styles.date}>{monthDayLabel(day.date)}</h3>
                    <ul className={styles.events}>
                      {day.events.map((event) => (
                        <li key={event.id} className={event.kind === 'move' ? `${styles.event} ${styles.move}` : styles.event}>
                          <span className={styles.time}>
                            {event.startTime}〜{event.endTime}
                          </span>
                          <span className={styles.name}>{event.summary}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {phase.kind === 'failed' && (
                <p className={styles.problem} role="alert">
                  {phase.message}
                </p>
              )}
              {phase.kind === 'failed' && !phase.retry ? (
                // 許可が切れた・ないときは、ここから押し直しても入れられない。閉じて、Google の許可からやり直す
                <Button block onClick={close}>
                  {translate('閉じる', "Close")}
                </Button>
              ) : (
                <div className={styles.buttons}>
                  <Button onClick={close} disabled={sending}>
                    {translate('やめる', 'Cancel')}
                  </Button>
                  <Button variant="go" onClick={() => void send()} disabled={sending}>
                    {sending ? translate(`入れています… ${phase.done}/${events.length}`, `Adding… ${phase.done}/${events.length}`) : translate('カレンダーに入れる', "Add to calendar")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </dialog>,
        document.body,
      )}
    </>
  )
}
