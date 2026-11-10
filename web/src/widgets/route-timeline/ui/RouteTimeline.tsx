import type { CSSProperties } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { CategoryIcon, type Pin } from '@/entities/pin'
import { type Route, scheduleByDay, withOriginStop } from '@/entities/route'
import type { Wish } from '@/entities/wish'
import type { WithId } from '@/shared/api'
import { addDays, monthDayLabel } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import styles from './RouteTimeline.module.css'

interface Props {
  route: Route
  /** 旅の開始日（YYYY-MM-DD）。2 日以上の旅で「2 日目 11/22（日）」と出すのに使う */
  startDate: string
  pins: readonly WithId<Pin>[]
  members: readonly WithId<Member>[]
  wishes: readonly WithId<Wish>[]
  /** いま見ている地点。行を目立たせる */
  activePinId?: string | null
  /** 場所の行を押したとき（場所の情報 S12 を開く）。渡さなければ、行は押せない */
  onSelectStop?: (pinId: string) => void
  /**
   * 出発地（集合場所）の名前。渡すと、しおりに出発の行がない旅（出発地の位置が分からないとき、Functions は入れない）でも、
   * 1 日目の先頭に集合場所の行を出す（時刻は出さない）。場所の情報で回る並びの先頭と合わせるため（#226）
   */
  origin?: string
  /** 集合場所の行を押したとき（集合場所の情報を開く）。渡さなければ、集合場所の行は押せない */
  onSelectOrigin?: () => void
}

/**
 * しおり（S11）の行。建った場所が旅の順に並ぶ：時刻、地点、誰のやりたいことか。
 * 丸の色は、その場所を希望した人の色。出発地の行は「集合場所」。
 * 時刻は、直線距離から計算したおおよその目安（Functions の domain/routePlan.ts）。
 */
export function RouteTimeline({ route, startDate, pins, members, wishes, activePinId, onSelectStop, origin, onSelectOrigin }: Props) {
  const days = scheduleByDay(origin ? withOriginStop(route.schedule, origin) : route.schedule)
  const manyDays = days.length > 1
  return (
    <div className={styles.timeline}>
      {days.map(({ day, stops }) => (
        <section key={day} className={styles.day} aria-label={`${day} 日目`}>
          {manyDays && (
            <h3 className={styles.dayTitle}>
              {day} 日目<span className={styles.date}>{monthDayLabel(addDays(startDate, day - 1))}</span>
            </h3>
          )}
          <ol className={styles.stops}>
            {stops.map((stop, index) => {
              const pin = pins.find((item) => item.id === stop.pinId)
              const wisher = pin ? members.find((member) => member.id === pin.uid) : undefined
              const wish = pin ? wishes.find((item) => item.id === pin.wishId) : undefined
              const active = Boolean(stop.pinId) && stop.pinId === activePinId
              const dotStyle = { '--dot-color': wisher?.color ?? 'var(--color-text-sub)' } as CSSProperties
              const body = (
                <>
                  <span className={pin ? styles.dot : `${styles.dot} ${styles.origin}`} style={pin ? dotStyle : undefined}>
                    {pin ? <CategoryIcon category={pin.category} size={20} /> : <Icon name="train" size={20} />}
                  </span>
                  <time className={styles.time}>{stop.time}</time>
                  <span className={styles.text}>
                    <span className={styles.name}>{pin ? stop.name : stop.name.replace(/ 出発$/, '')}</span>
                    {pin ? (
                      (wisher || wish) && (
                        <span className={styles.sub}>
                          {wisher && <Avatar member={wisher} size={18} />}
                          {wish && <span className={styles.wish}>「{wish.text}」</span>}
                        </span>
                      )
                    ) : (
                      <span className={styles.sub}>集合場所</span>
                    )}
                  </span>
                  {((pin && onSelectStop) || (!pin && onSelectOrigin)) && (
                    <span className={styles.chevron}>
                      <Icon name="chevron" size={20} />
                    </span>
                  )}
                </>
              )
              const className = active ? `${styles.stop} ${styles.active}` : styles.stop
              const select = stop.pinId ? onSelectStop && (() => onSelectStop(stop.pinId!)) : onSelectOrigin
              return (
                <li key={`${stop.pinId ?? 'origin'}-${index}`} className={styles.item}>
                  {select ? (
                    <button type="button" className={className} aria-current={active ? 'step' : undefined} onClick={select}>
                      {body}
                    </button>
                  ) : (
                    <div className={className}>{body}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
