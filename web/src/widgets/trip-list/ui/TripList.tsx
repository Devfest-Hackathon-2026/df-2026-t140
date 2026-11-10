import { Link } from 'react-router'
import { type Membership, useMembers } from '@/entities/member'
import { useTrip } from '@/entities/trip'
import { monthDayLabel, nightsLabel, playSound } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import styles from './TripList.module.css'

interface Props {
  memberships: Membership[]
  /** さっきまで開いていた旅。目印を付ける */
  currentTripId: string | null
}

/** 計画中の旅の一覧（M01）。押すと、その旅に切り替わる */
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
        <p className={styles.placeholder}>{trip.loading ? '読み込んでいます…' : 'この旅を読み込めませんでした'}</p>
      </div>
    )
  }

  const { title, startDate, endDate, status } = trip.data
  const count = members.data ? `・${members.data.length}人` : ''
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
            <span className={`${styles.badge} ${styles.open}`}>いま開いている</span>
          ) : status === 'decided' ? (
            <span className={`${styles.badge} ${styles.decided}`}>決定</span>
          ) : (
            <span className={`${styles.badge} ${styles.planning}`}>計画中</span>
          )}
        </span>
        <span className={styles.detail}>
          {monthDayLabel(startDate)}〜 {nightsLabel(startDate, endDate)}
          {count}
        </span>
      </span>
    </Link>
  )
}
