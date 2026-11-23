import { useEffect, useRef, useState } from 'react'
import {
  ALL_PREFECTURES,
  areaDisplayName,
  originLocation,
  type PickedPrefectures,
  pickedLabel,
  pickerBand,
  REGION_IDS,
  regionDisplayName,
  REGION_PREFECTURES,
  type RegionId,
  ROLL_STEPS,
  rollHops,
  type LatLng,
  normalizePrefectures,
  type TravelMode,
  type TripInfo,
  distanceKm,
  untouchedRegions,
} from '@/entities/trip'
import { nights, playSound } from '@/shared/lib'
import { PREFECTURE_POINTS, pickedTargets } from '@/widgets/trip-map'
import { rollChoices } from './reach'
import { placeReaction } from './tripQuiz'

/** 止まった地方を「〇〇に決まり！」と見せておく時間（ms） */
const LANDED_MS = 1800
/** 光が最後の地方に止まってから、その地方を選ぶまでの間（ms） */
const SETTLE_MS = 600

interface Options {
  info: TripInfo
  initial: PickedPrefectures
  /** 「つぎへ」を押したとき。選んだ県の名前を渡す（最後の旅の名前の問いへ進む） */
  onNext: (picked: string[]) => void
  /** サイコロが止まって地方を選んだとき（一覧のその行を見えるところまで送るのに使う） */
  onLanded?: (id: RegionId) => void
  /** サイコロで選ぶ先をしぼる、出発地の位置と乗り物（model/reach.ts） */
  reach?: { from: LatLng | null; mode: TravelMode | null }
}

/**
 * 大まかな場所を選ぶ画面（ui/RegionPicker.tsx）の状態と操作。選んだ県、サイコロ、問いの下の一言、つぎへ。
 * サイコロを振っているあいだは、選び直せない。旅を作るのは、このあとの旅の名前の問い（ページが持つ）
 */
export function useRegionPicker({ info, initial, onNext, onLanded, reach }: Options) {
  const [picked, setPicked] = useState<string[]>(() => [...initial])
  // サイコロ：光っている地方（ふっているあいだ）と、止まった地方（少しのあいだ「〇〇に決まり！」と出す）
  const [rolling, setRolling] = useState<RegionId | null>(null)
  const [landed, setLanded] = useState<RegionId | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])

  const all = picked.length === ALL_PREFECTURES.length
  const origin = info.origin.trim()
  const home = originLocation(origin)
  const band = pickerBand({
    rolling: rolling && regionDisplayName(rolling),
    landed: landed && regionDisplayName(landed),
    places: pickedTargets(picked).map((place) => ({ ...place, name: areaDisplayName(place.name) })),
    label: pickedLabel(picked),
    all,
    origin,
    home,
    title: info.title.trim(),
    startDate: info.startDate,
    endDate: info.endDate,
  })
  const locked = rolling !== null
  // 問いの下の一言（帯の中身を 1 行にしたもの）
  const reaction = placeReaction(band, rolling !== null, landed !== null)

  /** 選び直す（地方の行、県の行、すべて選ぶ／外す） */
  const pick = (next: string[]) => {
    if (locked) return
    playSound('select')
    setLanded(null)
    setPicked(next)
  }
  const toggleAll = () => pick(all ? [] : [...ALL_PREFECTURES])

  // サイコロ：まだ県を 1 つも選んでいない地方の中から 1 つ選ぶ。選ぶのは、乗り物と日数で行ける範囲の県だけ（model/reach.ts。
  // 光はどの地方にも跳ねる）。光を地方から地方へ跳ねさせ、だんだん遅くして止める。動きを減らす設定のときは、跳ねさせずにすぐ選ぶ
  const roll = () => {
    if (locked) return
    const rest = untouchedRegions(picked)
    if (rest.length === 0) return
    const choices = rollChoices({
      regions: rest.map((id) => ({ id, prefectures: REGION_PREFECTURES[id] })),
      from: reach?.from ?? null,
      mode: reach?.mode ?? null,
      nights: nights(info.startDate, info.endDate),
      prefectures: PREFECTURE_POINTS,
      distance: distanceKm,
    })
    const choice = choices[Math.floor(Math.random() * choices.length)]
    const target = choice.region
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms))
    setLanded(null)
    const hops = rollHops(REGION_IDS, target, quiet ? 1 : ROLL_STEPS, Math.random)
    for (const hop of hops) {
      later(quiet ? 0 : hop.at, () => {
        if (!quiet) playSound('move')
        setRolling(hop.id)
      })
    }
    later(quiet ? 0 : hops[hops.length - 1].at + SETTLE_MS, () => {
      playSound('discover')
      setRolling(null)
      setLanded(target)
      setPicked((current) => normalizePrefectures([...current, ...choice.prefectures]))
      onLanded?.(target)
      later(LANDED_MS, () => setLanded((current) => (current === target ? null : current)))
    })
  }

  /** 最後の旅の名前の問いへ進む */
  const next = () => {
    if (locked || picked.length === 0) return
    onNext(picked)
  }

  return { picked, all, origin, home, reaction, rolling, landed, locked, pick, toggleAll, roll, next }
}
