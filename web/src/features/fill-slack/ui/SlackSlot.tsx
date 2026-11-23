import { CATEGORY_LABELS, CategoryIcon, pinDisplayDescription, pinDisplayName, type Pin } from '@/entities/pin'
import { clockOf, type DaySlack, durationLabel } from '@/entities/route'
import type { WithId } from '@/shared/api'
import { translate } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import styles from './SlackSlot.module.css'

interface Props {
  /** その日の空いた時間（entities/route の daySlacks） */
  slack: DaySlack
  /** その日の空きへの提案（まだ「無視」も建築もされていないもの） */
  fillers: readonly WithId<Pin>[]
  /** 「入れる」を押した（建築を頼む。建つと、しおりに入る） */
  onInclude: (pin: WithId<Pin>) => void
  /** 「無視」を押した（その提案を消し、同じ場所は二度と出さない） */
  onDismiss: (pin: WithId<Pin>) => void
  /** 頼んでいる途中の提案（そのボタンを押せなくする） */
  busyId: string | null
  /** 旅程が確定している（提案の欄を出さない。ゆとりの行だけ） */
  locked?: boolean
}

/**
 * しおりの「ゆとり」の行と、空いた時間への提案の欄（#520。Takana の決定、2026-11-21）。その日の最後の行の下に出す。
 * - ゆとりの行：最後の場所を出てから 19 時（宿・夜景へ向かう前、旅の最後は帰る前）までの空き。予定のない日は、まるごとゆとり。余白だと分かるよう、点線の枠の薄い字で出す
 * - 提案の欄：空きが 2 時間以上ある日に、近くの見本の場所を 1 つ、薄い字で出す。「入れる」で建築を頼み（建つとしおりに入る）、「無視」で消す。
 *   提案は地図にも薄い青のピンで出る。見本の場所の一覧から選んだもので、AI の提案ではないことを書く
 */
export function SlackSlot({ slack, fillers, onInclude, onDismiss, busyId, locked }: Props) {
  const range = `${clockOf(slack.from)}${translate('〜', '–')}${clockOf(slack.to)}`
  const duration = durationLabel(slack.minutes)
  return (
    <section className={styles.slot} aria-label={translate(`${slack.day} 日目のゆとり`, `Free time on day ${slack.day}`)}>
      <p className={styles.slack}>
        <span className={styles.dot} aria-hidden="true">
          <Icon name="clock" size={20} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{slack.empty ? translate('まだ予定のない日', 'No plans yet') : translate('ゆとり', 'Free time')}</span>
          <span className={styles.sub}>
            {translate(`${range}（${duration}）`, `${range} (${duration})`)}
          </span>
        </span>
      </p>
      {!locked &&
        fillers.map((pin) => (
          <div key={pin.id} className={styles.filler}>
            <p className={styles.fillerTitle}>
              <span className={styles.fillerDot} aria-hidden="true">
                <CategoryIcon category={pin.category} size={20} />
              </span>
              <span className={styles.text}>
                <span className={styles.fillerName}>{pinDisplayName(pin)}</span>
                <span className={styles.sub}>
                  {translate('近くの提案・', 'Nearby suggestion · ')}{CATEGORY_LABELS[pin.category]}
                  {pinDisplayDescription(pin) ? `${translate('・', ' · ')}${pinDisplayDescription(pin)}` : ''}
                </span>
              </span>
            </p>
            <div className={styles.actions}>
              <Button variant="route" size="small" sound={false} disabled={busyId !== null} onClick={() => onInclude(pin)}>
                <Icon name="plus" size={18} />
                {translate('入れる', 'Add')}
              </Button>
              <Button variant="text" size="small" sound={false} disabled={busyId !== null} onClick={() => onDismiss(pin)}>
                {translate('無視', 'Dismiss')}
              </Button>
            </div>
            <p className={styles.note}>{translate('見本の場所リストから選んだ提案です（AI の提案ではありません）', 'This suggestion comes from the sample place list.')}</p>
          </div>
        ))}
    </section>
  )
}
