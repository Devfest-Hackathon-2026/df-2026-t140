import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/shared/api'
import { translate, clockLabel, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { setStopTime } from '../api/setStopTime'

interface Target {
  tripId: string
  routeId: string
  /** 直す時刻のキー（@meet、@origin、場所に着く時刻は行の ID、出る時刻は行の ID@leave） */
  stopKey: string
  /** しおりに出ている時刻（HH:MM） */
  saved: string
}

/** 直すと時刻が決まったイベントの時間と重なるので、確かめているところ。minutes は入れた時刻、names は重なるイベントの名前 */
export interface StopTimeClash {
  minutes: number
  names: string[]
}

/** 確かめているあいだの記録。from は、確かめ始めたときにしおりに出ていた時刻 */
interface PendingClash extends StopTimeClash {
  from: string
}

/**
 * しおりの時刻を直す。決めたらすぐ入れた時刻を出し、しおりの購読で時刻が変わるまで（届かなければ 5 秒）出し続ける。
 * 断られたとき（場所が消えた）と失敗したときは、元の時刻に戻して知らせる。
 * 直すと時刻が決まったイベントの時間と重なるときは、確定する前に確かめる（clash。Takana の決定、2026-11-21、#581）。
 * 「このまま変える」（keep）なら重なっても直し、「やめる」（drop）なら元の時刻に戻す
 */
export function useStopTime({ tripId, routeId, stopKey, saved }: Target) {
  const session = useSession()
  const toast = useToast()
  // 入れた時刻と、入れたときにしおりに出ていた時刻。しおりの時刻がそこから変わったら（購読が届いたら）、入れた時刻は出さない
  const [pending, setPending] = useState<{ value: string; from: string } | null>(null)
  const [clash, setClash] = useState<PendingClash | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stopTimer, [])
  const shown = pending && pending.from === saved ? pending.value : null

  async function commit(minutes: number, force = false) {
    stopTimer()
    setClash(null)
    setPending({ value: clockLabel(minutes), from: saved })
    try {
      const { status, names } = await setStopTime(session, { tripId, routeId, key: stopKey, minutes, ...(force ? { force } : {}) })
      if (status === 'changed') {
        timer.current = setTimeout(() => setPending(null), 5000)
        return
      }
      if (status === 'clash') {
        // 入れた時刻は出したまま、確かめる
        playSound('attention')
        setClash({ minutes, names: names ?? [], from: saved })
        return
      }
      playSound('attention')
      toast(translate('しおりが変わったので、時刻をもう一度入れてください', "The itinerary changed. Enter the time again."))
      setPending(null)
    } catch {
      playSound('error')
      toast(translate('時刻を変えられませんでした。もう一度試してください', "Couldn't change the time. Try again."))
      setPending(null)
    }
  }

  // 確かめているあいだに、ほかの人の変更でしおりの時刻が変わったら、確認は閉じる（古い入力で、新しいしおりを上書きしない）
  const open = clash && clash.from === saved ? clash : null
  const keep = () => {
    if (open) void commit(open.minutes, true)
  }
  const drop = () => {
    playSound('close')
    setClash(null)
    setPending(null)
  }

  return {
    value: shown ?? saved,
    busy: shown !== null && open === null,
    commit: (minutes: number) => commit(minutes),
    clash: open ? { minutes: open.minutes, names: open.names } : null,
    keep,
    drop,
  }
}
