import { Link } from 'react-router'
import { useMembers } from '@/entities/member'
import type { Trip } from '@/entities/trip'
import type { WithId } from '@/shared/api'
import { monthDayLabel, nightsLabel, playSound, translate as t } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import styles from './TripList.module.css'

interface Props {
  /** 発案者が旅程を確定した旅 */
  trips: WithId<Trip>[]
  /** 過去の旅（最終日を過ぎた旅）の欄か。「確定」の印を出さず、絵の地を灰色にする（企画書「ユーザー体験」4-1） */
  past?: boolean
}

/**
 * 決まったしおりの一覧と、過去の旅の一覧（M01。計画中の旅の下）。押すと、その旅の決まったしおり（S14。地図なしの別の画面）が開く。
 * 2026-11-18 の #393 の形に戻した（2026-11-21、#502）。前は確定したときの写しを開いたが、今は今のしおりを開く
 */
export function FinalShioriList({ trips, past = false }: Props) {
  return (
    <ul className={styles.list}>
      {trips.map((trip) => (
        <li key={trip.id}>
          <FinalShioriItem trip={trip} past={past} />
        </li>
      ))}
    </ul>
  )
}

function FinalShioriItem({ trip, past }: { trip: WithId<Trip>; past: boolean }) {
  const members = useMembers(trip.id)
  const count = members.data?.length
  return (
    <Link
      to={`/t/${trip.id}/final`}
      className={styles.item}
      onClick={(event) => {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) playSound('open')
      }}
    >
      <span className={`${styles.tile} ${past ? styles.pastTile : styles.finalTile}`}>
        <Icon name="bookmark" size={28} />
      </span>
      <span className={styles.text}>
        <span className={styles.titleRow}>
          <span className={styles.title}>{trip.title}</span>
          {!past && <span className={`${styles.badge} ${styles.decided}`}>{t('確定', 'Finalized')}</span>}
        </span>
        <span className={styles.detail}>
          {monthDayLabel(trip.startDate)}{t('〜 ', ' · ')}{nightsLabel(trip.startDate, trip.endDate)}
          {count !== undefined && t(`・${count}人`, ` · ${count} ${count === 1 ? 'person' : 'people'}`)}
        </span>
      </span>
    </Link>
  )
}
