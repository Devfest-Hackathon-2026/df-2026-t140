import { Link } from 'react-router'
import { type Membership, useMembers } from '@/entities/member'
import { useTrip } from '@/entities/trip'
import { monthDayLabel, nightsLabel, playSound, translate as t } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import styles from './TripList.module.css'

interface Props {
  memberships: Membership[]
  /** さっきまで開いていた旅。目印を付ける */
  currentTripId: string | null
}

/** 計画中の旅の一覧（M01）。押すと、その旅（地図）に切り替わる。発案者が旅程を確定した旅は FinalShioriList に並ぶ */
export function TripList({ memberships, currentTripId }: Props) {
  return (
    <ul className={styles.list}>
      {memberships.map(({ tripId }) => (
        <li key={tripId}>
          <TripListItem tripId={tripId} current={tripId === currentTripId} />
        </li>
      ))}
    </ul>
  )
}

function TripListItem({ tripId, current }: { tripId: string; current: boolean }) {
  const trip = useTrip(tripId)
  const members = useMembers(tripId)

  if (!trip.data) {
    return (
      <div className={styles.item}>
        <p className={styles.placeholder}>{trip.loading ? t('読み込んでいます…', 'Loading…') : t('この旅を読み込めませんでした', 'Could not load this trip')}</p>
      </div>
    )
  }

  const { title, startDate, endDate } = trip.data
  const count = members.data?.length
  return (
    <Link to={`/t/${tripId}`} className={current ? `${styles.item} ${styles.current}` : styles.item} onClick={(event) => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) playSound('open')
    }}>
      <span className={styles.tile}>
        <Icon name="map" size={28} />
      </span>
      <span className={styles.text}>
        <span className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {current ? (
            <span className={`${styles.badge} ${styles.open}`}>{t('いま開いている', 'Currently open')}</span>
          ) : (
            // 前の形で「決定」になった旅も、確定の印がなければ計画中として並べる（2026-11-21、#502）
            <span className={`${styles.badge} ${styles.planning}`}>{t('計画中', 'Planning')}</span>
          )}
        </span>
        <span className={styles.detail}>
          {monthDayLabel(startDate)}{t('〜 ', ' · ')}{nightsLabel(startDate, endDate)}
          {count !== undefined && t(`・${count}人`, ` · ${count} ${count === 1 ? 'person' : 'people'}`)}
        </span>
      </span>
    </Link>
  )
}
