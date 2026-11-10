import type { WithId } from '@/shared/api'
import type { Pin, PinCategory } from './types'

/** 場所の種類の、画面に出す名前 */
export const CATEGORY_LABELS: Record<PinCategory, string> = {
  onsen: '温泉',
  ski: 'スキー',
  food: 'グルメ',
  farm: '農園',
  nightview: '夜景',
  nature: '自然',
  shrine: '寺社・城',
  themepark: 'あそび',
  town: '街歩き',
}

/** 1 つの旅で建てられる数。Functions の決め（functions/src/domain/pin.ts の BUILD_LIMIT_PER_TRIP）と合わせる */
export const BUILD_LIMIT_PER_TRIP = 20

/** 同じ希望から立った候補のピン（立った順）。場所カードの「1 / 3」に使う */
export function candidatesOfWish(pins: readonly WithId<Pin>[], wishId: string): WithId<Pin>[] {
  return pins.filter((pin) => pin.wishId === wishId).sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * 場所カードを左右にスワイプして選ぶ、同じ希望の前後の候補（ヨウキンが 2026-11-07 に決めた）。
 * 候補（candidate）と建築に失敗したピン（failed）だけを並べ、いまのピンがそのどちらでもなければ前後はない
 * （建築中・建った建物のカードは adjacentBuildings で、旅の建物どうしで移る）。端なら null（一周しない）
 */
export function adjacentCandidates<T extends Pick<Pin, 'status'> & { id: string }>(
  group: readonly T[],
  currentId: string,
): { prev: T | null; next: T | null } {
  const choosable = group.filter((pin) => pin.status === 'candidate' || pin.status === 'failed')
  const index = choosable.findIndex((pin) => pin.id === currentId)
  if (index < 0) return { prev: null, next: null }
  return { prev: choosable[index - 1] ?? null, next: choosable[index + 1] ?? null }
}

/**
 * 建物（建築中・建った）のカードを左右にスワイプして移る、旅の前後の建物（Youkin06 が 2026-11-07 に頼んだ。#117）。
 * 並びはしおりの順（orders：ピンの ID → しおりの何番目か）。しおりにまだ入っていない建物は、そのあとに ID の順で並べる。
 * いまのピンが建物でなければ前後はない（候補のカードは adjacentCandidates で、同じ希望の候補のあいだで移る）。端なら null
 */
export function adjacentBuildings<T extends Pick<Pin, 'status'> & { id: string }>(
  pins: readonly T[],
  currentId: string,
  orders: Readonly<Record<string, number>>,
): { prev: T | null; next: T | null } {
  const order = (pin: T) => orders[pin.id] ?? Number.POSITIVE_INFINITY
  const buildings = pins
    .filter((pin) => pin.status === 'building' || pin.status === 'done')
    .sort((left, right) => order(left) - order(right) || left.id.localeCompare(right.id))
  const index = buildings.findIndex((pin) => pin.id === currentId)
  if (index < 0) return { prev: null, next: null }
  return { prev: buildings[index - 1] ?? null, next: buildings[index + 1] ?? null }
}

/** 建物の数（工事中と完成）と、ピンの数（候補も建物も全部） */
export function pinCounts(pins: readonly Pin[]): { buildings: number; pins: number } {
  const buildings = pins.filter((pin) => pin.status === 'building' || pin.status === 'done').length
  return { buildings, pins: pins.length }
}

/** 候補のピンを、立ってから自分の地図に出しておく時間（5 分） */
export const CANDIDATE_VISIBLE_MS = 5 * 60 * 1000

type VisibilityFields = Pick<Pin, 'uid' | 'builtBy' | 'status' | 'wishId'>

/** 見せるかどうかを決めるのに要る、この人の状態 */
export interface Viewer {
  uid: string
  /** いちばん新しい検索（自分の希望で、候補が出終わったもの）。なければ null */
  currentWishId: string | null
  /** その検索の候補が立ってから 5 分たったか */
  candidatesExpired: boolean
  /** いま場所カードで見ている候補の検索。見ている途中では、その検索の候補を消さない */
  keepWishId: string | null
}

/**
 * この人の地図に出すピン（企画書「実装で仮に決めたこと」）。
 * - 建てたもの（工事中と完成）は全員に出す
 * - 候補のピンは、その希望を書いた本人にだけ、いちばん新しい検索のぶんを、立ってから 5 分だけ出す。
 *   次の検索の候補が出たら、前の検索の候補はすぐ消える（全員の候補や前の候補が並ぶと情報が多すぎるため）。
 *   場所カードで見ている検索の候補は、5 分を過ぎても閉じるまで消さない（「候補 1/3」で次を見られるように）
 * - 建築に失敗したピンは、希望を書いた人と建てようとした人にだけ出す（もう一度建てられるように）
 * データは前と同じく旅のメンバーが読める。見せるかどうかだけを決める
 */
export function isVisibleTo(pin: VisibilityFields, viewer: Viewer): boolean {
  if (pin.status === 'building' || pin.status === 'done') return true
  if (pin.status === 'failed') return pin.uid === viewer.uid || pin.builtBy === viewer.uid
  if (pin.uid !== viewer.uid) return false
  if (pin.wishId === viewer.keepWishId) return true
  return pin.wishId === viewer.currentWishId && !viewer.candidatesExpired
}

/** この人の地図に出すピンだけ（順番はそのまま） */
export function visiblePins<T extends VisibilityFields>(pins: readonly T[], viewer: Viewer): T[] {
  return pins.filter((pin) => isVisibleTo(pin, viewer))
}

/** その検索の候補が自分の地図から消える時刻（ms）。候補がまだ立っていなければ null */
export function candidatesExpireAt(pins: readonly Pick<Pin, 'wishId' | 'createdAt'>[], wishId: string): number | null {
  let latest: number | null = null
  for (const pin of pins) {
    if (pin.wishId !== wishId) continue
    const at = pin.createdAt?.toMillis?.()
    if (typeof at === 'number' && (latest === null || at > latest)) latest = at
  }
  return latest === null ? null : latest + CANDIDATE_VISIBLE_MS
}
