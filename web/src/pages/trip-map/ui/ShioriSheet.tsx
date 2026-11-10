import type { AnimationEvent, TransitionEvent } from 'react'
import type { Member } from '@/entities/member'
import type { Pin } from '@/entities/pin'
import type { Route } from '@/entities/route'
import type { Trip } from '@/entities/trip'
import type { Wish } from '@/entities/wish'
import type { WithId } from '@/shared/api'
import { useSheetDrag, useSheetMotion } from '@/shared/lib'
import { Icon, sheetDragFullStyle, sheetDragPeekStyle, sheetGripClass, sheetMotionClass, sheetPeekGripClass } from '@/shared/ui'
import { RouteTimeline } from '@/widgets/route-timeline'
import { HeaderBadge } from '@/widgets/trip-header'
import { dateRangeLabel, directionsUrl } from '../model/shiori'
import styles from './ShioriSheet.module.css'

interface Props {
  trip: Trip
  route: WithId<Route> | null
  /** しおりに並ぶ場所（旅の順） */
  pins: WithId<Pin>[]
  members: WithId<Member>[]
  wishes: WithId<Wish>[]
  onSelectPlace: (pinId: string) => void
  /** 集合場所の行を押した（集合場所の情報を開き、そこから旅の順に場所を見ていける。#226） */
  onSelectOrigin: () => void
  /** 上の部分だけを残した状態。地図に触れるとこうなる */
  peek: boolean
  /** 上の部分だけのときに、そこを押した（か、上へドラッグした）。しおりを元の高さに戻す */
  onExpand: () => void
  /** 取っ手を下へドラッグした（か、押した）。上の部分だけを残して下げる */
  onCollapse: () => void
  /** 再生ボタンを押した（旅を映像で見る）。建った場所がないときは出さない */
  onPlay: () => void
}

/**
 * しおり（S11）の下のシート。日程とメンバーの数、Google マップ、建った場所の行。
 * 行を押すと、場所の情報（S12）になる。先頭の集合場所の行を押すと、集合場所の情報になる（そこから旅の順に見ていける）。シートの外側の左上の再生ボタンで、旅を映像で見られる（車が道順をたどって場所を回る）。
 * 地図に触れると、日程の行だけを残して下がる（場所の情報のシートが閉じるのと同じ動き）。そこを押すと元の高さに上がる。
 */
export function ShioriSheet({ trip, route, pins, members, wishes, onSelectPlace, onSelectOrigin, peek, onExpand, onCollapse, onPlay }: Props) {
  const { phase, onAnimationEnd, peekRef, peekVisible } = useSheetMotion(peek, 'open')
  // 取っ手（閉じた形ではシート全体）をつかんで、上下にドラッグして開け閉めする
  const { offset, returning, launch, clearLaunch, onReturned: endReturn, fullRef, gripProps } = useSheetDrag(phase === 'peek' ? 'peek' : 'full', peekVisible, (to) => (to === 'peek' ? onCollapse() : onExpand()))
  const dragView = { offset, returning, launch }
  const onSheetAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    onAnimationEnd(event)
    if (event.target === event.currentTarget) clearLaunch()
  }
  const onReturned = (event: TransitionEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && returning) endReturn()
  }
  const dates = dateRangeLabel(trip.startDate, trip.endDate)
  const mapsUrl = route && pins.length > 0 ? directionsUrl(trip.origin, pins.map((pin) => pin.name)) : null
  const badges = (
    <>
      <HeaderBadge tone="route" icon="calendar" label={`日程 ${dates}`}>
        {dates}
      </HeaderBadge>
      <span className={styles.members}>
        <HeaderBadge tone="go" icon="people" label={`メンバー ${members.length} 人`}>
          {members.length}
        </HeaderBadge>
      </span>
    </>
  )

  // 旅を映像で見る再生ボタン：シートの外側の左上に浮かべ、シートといっしょに動く（閉じた形でも、その左上の外に残る）。
  // 車が道順をたどって、場所を順に回る（企画書「ユーザー体験」3-5）。押してもシートのドラッグは始めない
  const playButton =
    pins.length > 0 ? (
      <button type="button" className={styles.play} aria-label="旅を再生する" onClick={onPlay} onPointerDown={(event) => event.stopPropagation()}>
        <Icon name="play" size={26} />
      </button>
    ) : null

  if (phase === 'peek') {
    return (
      <section
        ref={peekRef}
        className={`${styles.sheet} ${styles.peek} ${sheetPeekGripClass}`}
        style={sheetDragPeekStyle(peekVisible, dragView)}
        aria-label="しおり（閉じています）"
        onTransitionEnd={onReturned}
        {...gripProps}
      >
        {playButton}
        <span className={styles.handle} aria-hidden="true" />
        {/* 上の部分のどこを押しても、しおりが元の高さに戻る */}
        <button type="button" className={styles.expand} aria-label="しおりを開く" onClick={onExpand}>
          {badges}
          <span className={styles.up} aria-hidden="true">
            <Icon name="up" size={20} />
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      ref={fullRef}
      className={`${styles.sheet} ${offset === null ? sheetMotionClass(phase) : ''}`}
      style={sheetDragFullStyle(peekVisible, dragView)}
      aria-label="しおり"
      onAnimationEnd={onSheetAnimationEnd}
      onTransitionEnd={onReturned}
    >
      {playButton}
      <span className={`${styles.handle} ${sheetGripClass}`} aria-hidden="true" {...gripProps} />
      <div className={styles.chips}>
        {badges}
        {mapsUrl && (
          <a className={styles.maps} href={mapsUrl} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} />
            Google マップ
          </a>
        )}
      </div>

      {route && pins.length > 0 ? (
        <div className={styles.timeline}>
          <RouteTimeline
            route={route}
            startDate={trip.startDate}
            pins={pins}
            members={members}
            wishes={wishes}
            onSelectStop={onSelectPlace}
            origin={trip.origin}
            onSelectOrigin={onSelectOrigin}
          />
        </div>
      ) : (
        <p className={styles.empty}>
          まだ建った場所がありません。やりたいことを書いて、気になった場所で「建築する！」を押すと、ここに旅の順で並びます。
        </p>
      )}
    </section>
  )
}
