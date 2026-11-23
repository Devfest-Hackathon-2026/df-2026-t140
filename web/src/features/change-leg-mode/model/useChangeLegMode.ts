import { useEffect, useRef, useState } from 'react'
import type { LegFlight, LegMode } from '@/entities/route'
import { useSession } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { changeLegMode } from '../api/changeLegMode'

export const LEG_MODES: readonly LegMode[] = ['transit', 'car', 'walk', 'plane']
export const LEG_MODE_LABELS: Record<LegMode, string> = { transit: translate('電車・バス', "Train and bus"), car: translate('車', "Car"), walk: translate('徒歩', "Walk"), plane: translate('飛行機', "Flight") }

/**
 * 飛行機の区間で画面に出すもの。flight：時刻表から選んだ便。lastFlight：乗れる便がなく、その日の最終便を案内する。
 * estimate：便を探したが、便も最終便も分からない目安。unsearched：まだ便を探していない目安（便を最初から探すようにする前に作ったしおりだけ。#482）。
 * 飛行機の区間でなければ null
 */
export type FlightView =
  | { kind: 'flight'; run: NonNullable<LegFlight['flight']>; fetchedAt: string }
  | { kind: 'lastFlight'; last: NonNullable<LegFlight['lastFlight']>; fetchedAt: string }
  | { kind: 'estimate' }
  | { kind: 'unsearched' }
  | null

export function flightView(mode: LegMode, shown: LegMode, flight: LegFlight | undefined): FlightView {
  if (mode !== 'plane' || shown !== 'plane') return null
  if (flight?.flight && flight.fetchedAt) return { kind: 'flight', run: flight.flight, fetchedAt: flight.fetchedAt }
  if (flight?.lastFlight && flight.fetchedAt) return { kind: 'lastFlight', last: flight.lastFlight, fetchedAt: flight.fetchedAt }
  return flight ? { kind: 'estimate' } : { kind: 'unsearched' }
}

interface Leg {
  tripId: string
  routeId: string
  from: string
  to: string
  /** この区間の、いまの手段（選んだもの、なければ旅全体の手段） */
  saved: LegMode
  /** 区間の既定（ふつうは旅全体の手段。遠い区間と島への区間は飛行機）。これを選んだら、区間の選択を外す */
  tripMode: LegMode
  /** この区間だけ手段を選んでいるか */
  chosen: boolean
  /** この区間で飛行機を選べるか（直線 200 km より近ければ、飛行機は出さない） */
  planeable: boolean
  /** 飛行機の区間で、便が決まっているか（目安のときは false。もう一度飛行機を押すと、便を探し直す） */
  hasFlight: boolean
}

/**
 * しおりの移動の行で、区間の手段を選び直す。押したらすぐ選んだ側を出し、しおりの購読が変わるまで（届かなければ 5 秒）出し続ける。
 * 区間の既定と同じ手段を選んだら、この区間の選択を外す（あとで旅全体を切り替えたら、それに合わせて変わる）。
 * 飛行機は既定と同じでも飛行機として送る（Functions が選択を外したうえで便を探す）
 */
export function useChangeLegMode({ tripId, routeId, from, to, saved, tripMode, chosen, planeable, hasFlight }: Leg) {
  const session = useSession()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<LegMode | null>(null)
  const waiting = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 購読の最新の値（応答より先に購読が届いたかを見る）
  const latest = useRef(saved)
  useEffect(() => {
    latest.current = saved
  }, [saved])
  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => {
    if (waiting.current) {
      waiting.current = false
      stopTimer()
      setPending(null)
    }
  }, [saved])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function choose(mode: LegMode) {
    setOpen(false)
    // 同じ手段を押したときは何もしない。ただし「この区間だけ」で旅全体と同じ手段なら、選択を外す
    // 飛行機で便が決まっていない（目安の）ときは、同じ飛行機を押しても便を探し直す
    const retryFlight = mode === 'plane' && saved === 'plane' && !hasFlight
    if (pending || (mode === saved && !(chosen && mode === tripMode) && !retryFlight)) return
    setPending(mode)
    try {
      const status = await changeLegMode(session, { tripId, routeId, from, to, mode: mode === tripMode && mode !== 'plane' ? null : mode })
      if (status === 'changed') {
        // 購読が先に届いていれば、もう待たない（旅全体と同じ手段を選んだときも、届いた値は選んだ手段になる）
        if (latest.current === mode) {
          setPending(null)
          return
        }
        waiting.current = true
        stopTimer()
        timer.current = setTimeout(() => {
          if (!waiting.current) return
          waiting.current = false
          setPending(null)
        }, 5000)
        return
      }
      playSound('attention')
      toast(
        status === 'too-far'
          ? translate('10 km より遠いので、徒歩は選べません', "Walking is unavailable for legs longer than 10 km.")
          : status === 'too-near'
            ? translate('200 km より近いので、飛行機は選べません', "Flying is unavailable for legs shorter than 200 km.")
            : translate('しおりの順番が変わったので、もう一度選んでください', "The stop order changed. Choose a travel mode again."),
      )
      setPending(null)
    } catch {
      playSound('error')
      toast(translate('移動手段を変えられませんでした。もう一度試してください', "Couldn't change the travel mode. Try again."))
      setPending(null)
    }
  }

  // 選択肢。飛行機は遠い区間だけ
  const options = LEG_MODES.filter((option) => option !== 'plane' || planeable)
  return { open, toggle: () => setOpen((value) => !value), value: pending ?? saved, busy: pending !== null, choose, options }
}
