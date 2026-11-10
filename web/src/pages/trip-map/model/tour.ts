// しおりの再生（ツアー）の小さな決め。車が道の線をたどって場所を順に回る。
// 地図の上でその場で動かすだけで、動画ファイルは作らない（Maps の内容を外へ持ち出さない）。
// 道の上の位置と向きの計算は、地図の部品（widgets/trip-map の lib/tourPath.ts）が持つ。

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

/** 再生の段（着いて止まる、次へ走る）。並べた順に進む。progress は、着いて止まるときの区間の上の位置（0 か 1） */
export interface TourStep<L> {
  kind: 'arrive' | 'drive'
  index: number
  ms: number
  leg: L
  progress: 0 | 1
}

/**
 * 再生の段を並べる。roads[i] は i 番目から i+1 番目の場所への区間。
 * originRoad（集合場所から 1 つ目の場所への区間）があれば、そこを走ってから 1 つ目の場所に着く。なければ 1 つ目の場所から始まる。
 * lone は、区間が 1 つもないときに止まる場所の区間を作る
 */
export function tourSteps<L extends { length: number }>(
  count: number,
  roads: readonly L[],
  originRoad: L | null,
  lone: (index: number) => L,
  skipDrive: boolean,
  startIndex: number | null = null,
): TourStep<L>[] {
  // null は集合場所から。場所を指定したときは、その場所への到着から始める。
  if (startIndex !== null && (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= count)) return []
  const drive = (index: number, leg: L): TourStep<L> => ({ kind: 'drive', index, ms: skipDrive ? 0 : driveMs(leg.length), leg, progress: 0 })
  const steps: TourStep<L>[] = startIndex === null && originRoad && count > 0 ? [drive(0, originRoad)] : []
  for (let index = startIndex ?? 0; index < count; index += 1) {
    const incoming = index === 0 ? originRoad : (roads[index - 1] ?? null)
    const next = roads[index] ?? null
    steps.push({ kind: 'arrive', index, ms: ARRIVE_MS, leg: incoming ?? next ?? lone(index), progress: incoming ? 1 : 0 })
    if (next) steps.push(drive(index + 1, next))
  }
  return steps
}

/** 走り出しと止まるときをゆっくりにする */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}
