// しおりの再生（ツアー）の小さな決め。車が道の線をたどって場所を順に回る。
// 地図の上でその場で動かすだけで、動画ファイルは作らない（Maps の内容を外へ持ち出さない）。
// 道の上の位置と向きの計算は、地図の部品（widgets/trip-map の lib/tourPath.ts）が持つ。

import type { LegMode } from '@/entities/route'
import type { TourVehicle } from '@/widgets/trip-map'

/** 場所に着いてから、次へ走り出すまで（ms）。名前と写真を見る時間 */
export const ARRIVE_MS = 4500
/** 1 区間を走る時間の下限と上限（ms）。遠い区間ほど長いが、長くなりすぎないようにする */
export const DRIVE_MIN_MS = 2600
export const DRIVE_MAX_MS = 6500

/** 区間を走る時間（ms）。距離の平方根に比例させ、近い区間も遠い区間も見ていられる長さにする */
export function driveMs(lengthMeters: number): number {
  const ms = 900 * Math.sqrt(lengthMeters / 1000)
  return Math.round(Math.min(DRIVE_MAX_MS, Math.max(DRIVE_MIN_MS, ms)))
}

/**
 * 再生の段（着いて止まる、次へ走る）。並べた順に進む。progress は、着いて止まるときの区間の上の位置（0 か 1）。
 * via は、区間の途中の場所（飛行機の区間の空港）に着いて止まる段。そのときの index は、その先で着く場所の番号
 */
export interface TourStep<L> {
  kind: 'arrive' | 'drive'
  index: number
  ms: number
  leg: L
  progress: 0 | 1
  via?: true
}

/**
 * 場所から次の場所までの道。途中の場所（空港）で区切るときは、区切った道の並び（1 つ目は区間の始まりから途中の場所まで）。
 * 区切った道はそれぞれ別の区間として走る（寄り具合も、区切った道の両端の距離で決まる）
 */
export type TourRoute<L> = L | readonly L[]

function partsOf<L>(road: TourRoute<L> | null | undefined): readonly L[] {
  if (road === null || road === undefined) return []
  return Array.isArray(road) ? (road as readonly L[]) : [road as L]
}

/**
 * 再生の段を並べる。roads[i] は i 番目から i+1 番目の場所への区間。
 * originRoad（集合場所から 1 つ目の場所への区間）があれば、そこを走ってから 1 つ目の場所に着く。なければ 1 つ目の場所から始まる。
 * 区切った区間（TourRoute が並び）は、区切りごとに走り、途中の場所で建物と同じだけ止まる（via）。
 * lone は、区間が 1 つもないときに止まる場所の区間を作る
 */
export function tourSteps<L extends { length: number }>(
  count: number,
  roads: readonly TourRoute<L>[],
  originRoad: TourRoute<L> | null,
  lone: (index: number) => L,
  skipDrive: boolean,
  startIndex: number | null = null,
): TourStep<L>[] {
  // null は集合場所から。場所を指定したときは、その場所への到着から始める。
  if (startIndex !== null && (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= count)) return []
  const drive = (index: number, leg: L): TourStep<L> => ({ kind: 'drive', index, ms: skipDrive ? 0 : driveMs(leg.length), leg, progress: 0 })
  // 区切った区間を走る段。区切りの間（途中の場所）では、着いて止まる
  const driveRoute = (index: number, parts: readonly L[]): TourStep<L>[] =>
    parts.flatMap((part, n): TourStep<L>[] =>
      n === 0 ? [drive(index, part)] : [{ kind: 'arrive', index, ms: ARRIVE_MS, leg: parts[n - 1], progress: 1, via: true }, drive(index, part)],
    )
  const origin = partsOf(originRoad)
  const steps: TourStep<L>[] = startIndex === null && origin.length > 0 && count > 0 ? driveRoute(0, origin) : []
  for (let index = startIndex ?? 0; index < count; index += 1) {
    const incoming = partsOf(index === 0 ? originRoad : roads[index - 1])
    const next = partsOf(roads[index])
    const last = incoming[incoming.length - 1]
    steps.push({ kind: 'arrive', index, ms: ARRIVE_MS, leg: last ?? next[0] ?? lone(index), progress: last ? 1 : 0 })
    if (next.length > 0) steps.push(...driveRoute(index + 1, next))
  }
  return steps
}

/** 再生の速さ（倍）。ボタンを押すたびに、この順に切り替わり、最後の次は最初に戻る */
export const TOUR_SPEEDS = [1, 2, 4] as const
export type TourSpeed = (typeof TOUR_SPEEDS)[number]

export function nextTourSpeed(speed: TourSpeed): TourSpeed {
  return TOUR_SPEEDS[(TOUR_SPEEDS.indexOf(speed) + 1) % TOUR_SPEEDS.length]
}

/**
 * 再生を始めてから elapsed（ms。倍速ぶんを掛け、一時停止のあいだを除いた、再生の中の時間）たったときの段と、
 * その段に入ってからの時間。最後の段を過ぎていたら null（再生は終わり）
 */
export function tourStepAt<S extends { ms: number }>(steps: readonly S[], elapsed: number): { step: S; elapsed: number } | null {
  let rest = elapsed
  for (const step of steps) {
    if (rest < step.ms) return { step, elapsed: rest }
    rest -= step.ms
  }
  return null
}

/**
 * 再生中に画面を押して、移動を飛ばしたときの、再生の中の時間（ms）。次に着いて止まる段の始まりを返す。
 * 走っているあいだは、その先で着く所（場所か、途中の空港）。着いて止まっているあいだは、その次に着く所。
 * 次に着く所がない（最後の場所で止まっている、再生が終わっている）ときは null（飛ばさない）
 */
export function nextArrivalAt<S extends { kind: 'arrive' | 'drive'; ms: number }>(steps: readonly S[], elapsed: number): number | null {
  let start = 0
  let current = -1
  for (let n = 0; n < steps.length; n += 1) {
    if (elapsed < start + steps[n].ms) {
      current = n
      break
    }
    start += steps[n].ms
  }
  if (current < 0) return null
  let time = start + steps[current].ms
  for (let n = current + 1; n < steps.length; n += 1) {
    if (steps[n].kind === 'arrive') return time
    time += steps[n].ms
  }
  return null
}

/** 走り出しと止まるときをゆっくりにする */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

/**
 * 区間の手段で走る乗り物。電車・バスは電車（区間ごとに電車かバスかを持っていないので、電車にそろえる）、徒歩は歩く人、飛行機は飛行機
 */
export function tourVehicleOf(mode: LegMode): TourVehicle {
  if (mode === 'transit') return 'train'
  if (mode === 'walk') return 'walker'
  if (mode === 'plane') return 'plane'
  return 'car'
}
