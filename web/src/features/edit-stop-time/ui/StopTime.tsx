import { STOP_TIME_NAMES, type StopTimeSlot } from '@/entities/route'
import { TimeField } from '@/shared/ui'
import { useStopTime } from '../model/useStopTime'
import { ClashDialog } from './ClashDialog'

interface Props {
  tripId: string
  routeId: string
  /** しおりの行の時刻 1 つ（entities/route の stopTimeSlots） */
  slot: StopTimeSlot
}

/**
 * しおりの行と場所の情報の、押して直せる時刻。
 * 押すと数字の入力欄になり、決めた時刻で Functions がしおりを組み直す。メンバーなら誰でも直せる（幹事だけにしない）。
 * 直すと時刻が決まったイベントの時間と重なるときは、確定する前に確かめる（ClashDialog。#581）
 */
export function StopTime({ tripId, routeId, slot }: Props) {
  const { value, busy, commit, clash, keep, drop } = useStopTime({ tripId, routeId, stopKey: slot.key, saved: slot.time })
  return (
    <>
      <TimeField value={value} label={STOP_TIME_NAMES[slot.kind]} busy={busy} onCommit={(minutes) => void commit(minutes)} />
      <ClashDialog clash={clash} onKeep={keep} onDrop={drop} />
    </>
  )
}
