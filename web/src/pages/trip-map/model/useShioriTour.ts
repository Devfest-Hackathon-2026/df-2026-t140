import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { LatLng } from '@/entities/pin'
import type { AirportStop, LegMode } from '@/entities/route'
import { focusTourSounds, playSound, prepareSounds } from '@/shared/lib'
import { makeLeg, type TourLeg } from '@/widgets/trip-map'
import { easeInOut, nextArrivalAt, nextTourSpeed, type TourRoute, type TourSpeed, type TourStep, tourStepAt, tourSteps } from './tour'

/**
 * 再生で走る道と、その道の手段（走る乗り物を決める）。
 * via は、この道の終わりが区間の途中の場所（飛行機の区間の空港）のときの、その場所（空港に着いて止まるときに名前と時刻を出す）
 */
export type TourRoad = TourLeg & { mode: LegMode; via?: AirportStop }

/**
 * 区間の道の点と、空の移動が点の何番目から何番目までか、乗り降りする空港（飛行機で空港を経由する区間だけ。ほかは null）
 */
export interface TourPath {
  points: readonly LatLng[]
  air: readonly [number, number] | null
  airports: { from: AirportStop; to: AirportStop } | null
}

/** これより短い区切り（m）は走らない（集合場所が空港そのもの、など。着いている場所から同じ場所へは走らない） */
const MIN_PART_METERS = 1

/**
 * 区間の道を作る。空港を経由する飛行機の区間は、空港で区切り、空港まで（地上の手段）→ 空港どうし（飛行機）→ 空港から（地上の手段）の
 * 3 つの道にする。空港は建物と同じく区間の端になり、寄り具合はそれぞれの道の両端の距離で決まる
 */
function routeOf(path: TourPath, mode: LegMode, ground: LegMode): TourRoute<TourRoad> {
  const { points, air, airports } = path
  if (!air || !airports || air[0] < 1 || air[1] <= air[0] || air[1] >= points.length - 1) return { ...makeLeg(points), mode }
  const parts: TourRoad[] = [
    { ...makeLeg(points.slice(0, air[0] + 1)), mode: ground, via: airports.from },
    { ...makeLeg(points.slice(air[0], air[1] + 1)), mode, via: airports.to },
    { ...makeLeg(points.slice(air[1])), mode: ground },
  ]
  // 空の移動の道は、短くても残す（空港どうしが近すぎる区間は、もとから空港を経由しない）
  const kept = parts.filter((part, n) => n === 1 || part.length >= MIN_PART_METERS)
  // 終わりの道には、途中の場所を付けない（区間の終わりの場所に着く）
  return kept.map((part, n) => (n === kept.length - 1 ? { ...part, via: undefined } : part))
}

/**
 * 再生の今。index は、着いている（か、向かっている）場所の、しおりでの番号（0 から）。
 * 車は leg（区間の道）の progress（0〜1）の所にいる。着いているときは、入ってきた区間の終わり（入ってきた区間がなければ、出ていく区間の始まり）。
 * via は、区間の途中の場所（空港）に着いて止まっているときの、その場所。index は、その先で着く場所
 */
export interface TourNow {
  index: number
  phase: 'arrive' | 'drive'
  leg: TourRoad
  progress: number
  via: AirportStop | null
}

type Step = TourStep<TourRoad>

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * しおりの再生（ツアー）。集合場所から 1 つ目の場所へ走り（originLeg。位置が分からなければ 1 つ目の場所から始める）、
 * しおりの順に、区間の道（legs[i] は i から i+1 へ）を走って回る。
 * 場所に着くたびに止まり（ARRIVE_MS）、最後の場所で止まったら終わる（onEnd）。
 * 一時停止（pause）すると、車はその場に残り、続き（resume）は止めた所から始まる。速さ（speed）は走る時間にも止まる時間にも掛かる。
 * 動きを減らす設定では走らず、場所から場所へ切り替える。
 * 区間ごとの手段（modes。legs と同じ並びと、集合場所からの区間）を道に添え、走る乗り物を区間ごとに変える。
 * 飛行機で空港を経由する区間は、空港で区切って走り、空港に着くたびに止まる。空港の前後は旅全体の手段（modes.ground）で走る。
 * 位置はページのメモリーにだけ持つ（道の形は Routes のもので、保存できないため）
 */
export function useShioriTour(
  stops: readonly LatLng[],
  legs: readonly TourPath[],
  originLeg: TourPath | null,
  modes: { legs: readonly LegMode[]; origin: LegMode; ground: LegMode },
  onEnd: () => void,
) {
  const [now, setNow] = useState<TourNow | null>(null)
  // 何回目の再生か。0 は止まっている。開始位置は、押した時点の段の一覧に含める。
  const [run, setRun] = useState(0)
  const [startIndex, setStartIndex] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  // 速さは、再生をやめても覚えておく（次に再生したときも同じ速さ）
  const [speed, setSpeed] = useState<TourSpeed>(1)
  const end = useEffectEvent(onEnd)
  const currentSpeed = useEffectEvent(() => speed)

  const steps = useMemo<Step[]>(() => {
    const skipDrive = reducedMotion()
    const roads = stops.slice(1).map((point, index): TourRoute<TourRoad> => {
      const road = legs[index]
      const mode = modes.legs[index] ?? modes.origin
      return road && road.points.length >= 2 ? routeOf(road, mode, modes.ground) : { ...makeLeg([stops[index], point]), mode }
    })
    const originRoad: TourRoute<TourRoad> | null =
      originLeg && originLeg.points.length >= 2 ? routeOf(originLeg, modes.origin, modes.ground) : null
    // 区間が 1 つもない（場所が 1 つで、集合場所の位置が分からない）ときは、集合場所からの手段の乗り物で止まる
    return tourSteps(stops.length, roads, originRoad, (index): TourRoad => ({ ...makeLeg([stops[index]]), mode: modes.origin }), skipDrive, startIndex)
  }, [stops, legs, originLeg, modes, startIndex])
  // 流しているあいだに、しおりの場所が変わっても（誰かが建てた）、始めたときの段のまま流す（次に押したときに入る）
  const stepsAtStart = useEffectEvent(() => steps)
  // いまの再生の、段の一覧と、再生の中の時間（ms）。一時停止をはさんでも続きから流せるよう、コマ送りの外に持つ
  // sounded は、もう音を鳴らした段（一時停止から続けたときに、同じ場所でシャッターを鳴らし直さない）
  const playback = useRef<{ steps: Step[]; elapsed: number; sounded: Step | null } | null>(null)

  const play = useCallback((from: number | null = null) => {
    prepareSounds()
    focusTourSounds(true)
    // 前の再生の続きは捨てる（段の一覧は、次のコマ送りの始めに、押した時点のものを取る）
    playback.current = null
    setStartIndex(from)
    setPaused(false)
    setRun((count) => count + 1)
  }, [])
  const stop = useCallback(() => {
    setRun(0)
    setPaused(false)
    setNow(null)
  }, [])
  const pause = useCallback(() => setPaused(true), [])
  const resume = useCallback(() => {
    prepareSounds()
    setPaused(false)
  }, [])
  const cycleSpeed = useCallback(() => setSpeed(nextTourSpeed), [])
  // 画面を押した：移動を飛ばし、次に着く所（場所か空港）へ一瞬で移る。次のコマで、着いた段として描く（シャッターも鳴る）。
  // 一時停止のあいだは飛ばさない（止めた所から続きを走るため）
  const skip = useCallback(() => {
    const state = playback.current
    if (!state || paused) return
    const next = nextArrivalAt(state.steps, state.elapsed)
    if (next !== null) state.elapsed = next
  }, [paused])

  useEffect(() => {
    if (run === 0 || paused) return
    focusTourSounds(true)
    const state = (playback.current ??= { steps: stepsAtStart(), elapsed: 0, sounded: null })
    let last = performance.now()
    const frame = { id: 0 }
    let currentStep: Step | null = null
    let stopStepSounds = () => {}
    const tick = () => {
      const time = performance.now()
      state.elapsed += (time - last) * currentSpeed()
      last = time
      const at = tourStepAt(state.steps, state.elapsed)
      if (!at) {
        setRun(0)
        setNow(null)
        end()
        return
      }
      const { step, elapsed } = at
      if (currentStep !== step) {
        stopStepSounds()
        currentStep = step
        if (step.kind === 'arrive') {
          // 到着音はシャッターにまとめ、画面復帰時に過ぎた到着音を鳴らさない。
          // 区間の途中の空港では鳴らさない（写真を撮った形で出す建物とちがい、名前だけを出すため）
          stopStepSounds = elapsed < 750 && state.sounded !== step && !step.via ? playSound('shutter', { channel: 'tour' }) : () => {}
          state.sounded = step
        } else {
          // 走るあいだは鳴らさない（車のエンジン音はたかなの指示で外した。2026-11-09）
          stopStepSounds = () => {}
        }
      }
      if (step.kind === 'arrive') {
        const { progress } = step
        const via = step.via ? (step.leg.via ?? null) : null
        setNow((current) =>
          // 止まっているあいだは、描き直さない（途中の空港と、その先の場所は同じ index なので、道でも見分ける）
          current?.phase === 'arrive' && current.index === step.index && current.leg === step.leg
            ? current
            : { index: step.index, phase: 'arrive', leg: step.leg, progress, via },
        )
      } else {
        setNow({ index: step.index, phase: 'drive', leg: step.leg, progress: easeInOut(elapsed / step.ms), via: null })
      }
      frame.id = requestAnimationFrame(tick)
    }
    frame.id = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame.id)
      stopStepSounds()
      focusTourSounds(false)
    }
  }, [run, paused])

  return { now, playing: run !== 0, paused: run !== 0 && paused, speed, play, stop, pause, resume, cycleSpeed, skip }
}
