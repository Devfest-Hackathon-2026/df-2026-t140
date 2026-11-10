import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import type { LatLng } from '@/entities/pin'
import { focusTourSounds, playSound, prepareSounds } from '@/shared/lib'
import { makeLeg, type TourLeg } from '@/widgets/trip-map'
import { easeInOut, type TourStep, tourSteps } from './tour'

/**
 * 再生の今。index は、着いている（か、向かっている）場所の、しおりでの番号（0 から）。
 * 車は leg（区間の道）の progress（0〜1）の所にいる。着いているときは、入ってきた区間の終わり（入ってきた区間がなければ、出ていく区間の始まり）
 */
export interface TourNow {
  index: number
  phase: 'arrive' | 'drive'
  leg: TourLeg
  progress: number
}

type Step = TourStep<TourLeg>

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * しおりの再生（ツアー）。集合場所から 1 つ目の場所へ走り（originLeg。位置が分からなければ 1 つ目の場所から始める）、
 * しおりの順に、区間の道（legs[i] は i から i+1 へ）を走って回る。
 * 場所に着くたびに止まり（ARRIVE_MS）、最後の場所で止まったら終わる（onEnd）。
 * 動きを減らす設定では走らず、場所から場所へ切り替える。
 * 位置はページのメモリーにだけ持つ（道の形は Routes のもので、保存できないため）
 */
export function useShioriTour(stops: readonly LatLng[], legs: readonly (readonly LatLng[])[], originLeg: readonly LatLng[] | null, onEnd: () => void) {
  const [now, setNow] = useState<TourNow | null>(null)
  // 何回目の再生か。0 は止まっている。開始位置は、押した時点の段の一覧に含める。
  const [run, setRun] = useState(0)
  const [startIndex, setStartIndex] = useState<number | null>(null)
  const end = useEffectEvent(onEnd)

  const steps = useMemo<Step[]>(() => {
    const skipDrive = reducedMotion()
    const roads = stops.slice(1).map((point, index) => {
      const road = legs[index]
      return makeLeg(road && road.length >= 2 ? road : [stops[index], point])
    })
    const originRoad = originLeg && originLeg.length >= 2 ? makeLeg(originLeg) : null
    return tourSteps(stops.length, roads, originRoad, (index) => makeLeg([stops[index]]), skipDrive, startIndex)
  }, [stops, legs, originLeg, startIndex])
  // 流しているあいだに、しおりの場所が変わっても（誰かが建てた）、始めたときの段のまま流す（次に押したときに入る）
  const stepsAtStart = useEffectEvent(() => steps)

  const play = useCallback((from: number | null = null) => {
    prepareSounds()
    focusTourSounds(true)
    setStartIndex(from)
    setRun((count) => count + 1)
  }, [])
  const stop = useCallback(() => {
    setRun(0)
    setNow(null)
  }, [])

  useEffect(() => {
    if (run === 0) return
    focusTourSounds(true)
    const list = stepsAtStart()
    const startedAt = performance.now()
    const frame = { id: 0 }
    let currentStep: Step | null = null
    let stopStepSounds = () => {}
    const tick = () => {
      let elapsed = performance.now() - startedAt
      for (const step of list) {
        if (elapsed >= step.ms) {
          elapsed -= step.ms
          continue
        }
        if (currentStep !== step) {
          stopStepSounds()
          currentStep = step
          if (step.kind === 'arrive') {
            // 到着音はシャッターにまとめ、画面復帰時に過ぎた到着音を鳴らさない。
            stopStepSounds = elapsed < 750 ? playSound('shutter', { channel: 'tour' }) : () => {}
          } else {
            // 走るあいだは鳴らさない（車のエンジン音はたかなの指示で外した。2026-11-09）
            stopStepSounds = () => {}
          }
        }
        if (step.kind === 'arrive') {
          const { progress } = step
          setNow((current) =>
            // 止まっているあいだは、描き直さない
            current?.phase === 'arrive' && current.index === step.index ? current : { index: step.index, phase: 'arrive', leg: step.leg, progress },
          )
        } else {
          setNow({ index: step.index, phase: 'drive', leg: step.leg, progress: easeInOut(elapsed / step.ms) })
        }
        frame.id = requestAnimationFrame(tick)
        return
      }
      setRun(0)
      setNow(null)
      end()
    }
    frame.id = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame.id)
      stopStepSounds()
      focusTourSounds(false)
    }
  }, [run])

  return { now, playing: run !== 0, play, stop }
}
