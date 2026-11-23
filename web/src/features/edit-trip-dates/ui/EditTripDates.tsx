import { TripCalendar } from '@/entities/trip'
import { dateRangeLabel, nightsLabel, translate } from '@/shared/lib'
import { Button } from '@/shared/ui'
import { useEditTripDates } from '../model/useEditTripDates'
import styles from './EditTripDates.module.css'

interface Props {
  tripId: string
  startDate: string
  endDate: string | null
  /** 発案者か。発案者だけが変えられる */
  isOwner: boolean
  /** 旅程を確定しているか。確定中は発案者も変えられない */
  confirmed: boolean
}

/**
 * 旅の設定のシートの、日程の行。発案者は「変える」でカレンダーを開き、行く日と帰る日を選び直せる（Lazyturtle0852 の決定、2026-11-22）。
 * ほかのメンバーには日程だけを出す
 */
export function EditTripDates({ tripId, startDate, endDate, isOwner, confirmed }: Props) {
  const form = useEditTripDates(tripId, startDate, endDate)
  const shown = form.range ? { start: form.range.start, end: form.range.awaitingEnd ? null : form.range.end } : { start: startDate, end: endDate }
  return (
    <section className={styles.dates} aria-label={translate('日程', 'Dates')}>
      <div className={styles.row}>
        <span className={styles.label}>{translate('日程', 'Dates')}</span>
        <b className={styles.value}>
          {dateRangeLabel(shown.start, shown.end)}{translate('（', ' (')}{nightsLabel(shown.start, shown.end)}{translate('）', ')')}
        </b>
        {isOwner && !confirmed && !form.editing && (
          <Button size="small" onClick={form.open}>
            {translate('変える', 'Change')}
          </Button>
        )}
      </div>
      {isOwner && confirmed && <p className={styles.note}>{translate('旅程を確定しているあいだは、日程を変えられません', "Dates can't be changed while the itinerary is finalized")}</p>}
      {!isOwner && <p className={styles.note}>{translate('日程を変えられるのは、発案者だけです', 'Only the organizer can change the dates')}</p>}
      {form.range && (
        <div className={styles.editor}>
          <TripCalendar start={form.range.start} end={form.range.awaitingEnd ? null : form.range.end} onPick={form.pick} />
          <p className={styles.note}>
            {form.range.awaitingEnd
              ? translate('帰る日を押してください。日帰りなら、同じ日をもう一度押してください', 'Choose the last day. For a day trip, choose the same day again')
              : translate('日程を縮めると、入りきらない場所はしおりから外れます。建物は地図に残ります', "If you shorten the trip, places that no longer fit are removed from the itinerary. Their buildings stay on the map")}
          </p>
          <div className={styles.actions}>
            <Button disabled={form.busy} onClick={form.close}>
              {translate('やめる', 'Cancel')}
            </Button>
            <Button variant="go" disabled={form.busy || form.range.awaitingEnd} onClick={() => void form.save()}>
              {form.busy ? translate('しおりを組み直しています…', 'Rebuilding the itinerary…') : translate('この日程にする', 'Use these dates')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
