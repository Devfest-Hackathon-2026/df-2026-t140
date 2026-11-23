import type { WithId } from '@/shared/api'
import { translate } from '../../../shared/lib/language.ts'
import type { LatLng, Pin, PinCategory } from './types'

export const CANDIDATE_PIN_WIDTH = 40
export const NAMED_PIN_WIDTH = 60
/** 前の検索の候補の、灰色の小さいピンの幅。面積が候補のピンの約半分になるよう、幅を 1/√2 にする（Takana の依頼、2026-11-22） */
export const PAST_PIN_WIDTH = 28

/** 場所の種類の、画面に出す名前 */
export const CATEGORY_LABELS: Record<PinCategory, string> = {
  onsen: translate('温泉', 'Hot spring'),
  ski: translate('スキー', 'Skiing'),
  food: translate('グルメ', 'Food'),
  farm: translate('農園', 'Farm'),
  nightview: translate('夜景', 'Night view'),
  nature: translate('自然', 'Nature'),
  shrine: translate('寺社・城', 'Temples, shrines & castles'),
  themepark: translate('あそび', 'Attractions'),
  town: translate('街歩き', 'Walking around town'),
  lodging: translate('宿', 'Lodging'),
}

/** 1 つの旅で建てられる数。Functions の決め（functions/src/domain/pin.ts の BUILD_LIMIT_PER_TRIP）と合わせる */
export const BUILD_LIMIT_PER_TRIP = 20

/**
 * 「工事中」のまま止まったとみなすまでの時間（#727）。Functions の domain/pin.ts の BUILD_STALE_MS と同じ値にする。
 * 建築の関数が時間切れや強制終了で止まると「失敗」が書かれないので、この時間をすぎた工事中は失敗として見せ、もう一度建てられるようにする
 */
export const BUILD_STALE_MS = 600_000

/** 工事中のまま止まったピンの ID（引き受けた時刻、まだなら最後に書いた時刻から BUILD_STALE_MS たったもの）。並びは pins の順 */
export function staleBuildIds(pins: readonly WithId<Pick<Pin, 'status' | 'buildStartedAt' | 'updatedAt'>>[], now: Date): string[] {
  return pins
    .filter((pin) => {
      if (pin.status !== 'building') return false
      const since = pin.buildStartedAt ?? pin.updatedAt
      const sinceMs = since && typeof since.toMillis === 'function' ? since.toMillis() : null
      return sinceMs !== null && now.getTime() - sinceMs > BUILD_STALE_MS
    })
    .map((pin) => pin.id)
}

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

/**
 * 建物の数（工事中と完成）と、ピンの数（候補も建物も全部）。
 * しおりの空いた時間への提案のうち「無視」したものは、地図に出ないので数えない（同じ場所を二度と出さないために残してあるだけ。#520）
 */
export function pinCounts(pins: readonly Pin[]): { buildings: number; pins: number } {
  const buildings = pins.filter((pin) => pin.status === 'building' || pin.status === 'done').length
  return { buildings, pins: pins.filter((pin) => !(pin.filler?.dismissed && pin.status === 'candidate')).length }
}

/** 空いた時間への提案の候補の wishId（Functions の domain/pin.ts の FILLER_WISH_ID と合わせる） */
export const FILLER_WISH_ID = '@filler'

/** 空いた時間への提案の候補のうち、まだ「無視」も建築もされていないもの（Functions の isOpenFiller と同じ決め） */
export function isOpenFiller(pin: Pick<Pin, 'filler' | 'status'>): boolean {
  return pin.filler !== undefined && !pin.filler.dismissed && pin.status === 'candidate'
}

type VisibilityFields = Pick<Pin, 'uid' | 'builtBy' | 'status' | 'wishId' | 'filler'>

/** 見せるかどうかを決めるのに要る、この人の状態 */
export interface Viewer {
  uid: string
}

/**
 * この人の地図に出すピン（企画書「実装で仮に決めたこと」）。
 * - 建てたもの（工事中と完成）は全員に出す
 * - 候補のピンは、その希望を書いた本人にだけ出す。前の検索の候補も消さずに残す（灰色の小さいピンで出す。isPastCandidate。Takana の依頼、2026-11-22）
 * - 建築に失敗したピンは、希望を書いた人と建てようとした人にだけ出す（もう一度建てられるように）
 * - しおりの空いた時間への提案の候補は、全員に、消えずに出す（しおりの提案の欄と同じものを地図でも見られるように。#520）。「無視」したものは出さない
 * データは前と同じく旅のメンバーが読める。見せるかどうかだけを決める
 */
export function isVisibleTo(pin: VisibilityFields, viewer: Viewer): boolean {
  if (pin.status === 'building' || pin.status === 'done') return true
  if (pin.status === 'failed') return pin.uid === viewer.uid || pin.builtBy === viewer.uid
  if (pin.filler) return isOpenFiller(pin)
  return pin.uid === viewer.uid
}

/** この人の地図に出すピンだけ（順番はそのまま） */
export function visiblePins<T extends VisibilityFields>(pins: readonly T[], viewer: Viewer): T[] {
  return pins.filter((pin) => isVisibleTo(pin, viewer))
}

/**
 * 前の検索の候補か。いちばん新しい検索（currentWishId。次の検索を書いたら、そちらに移る）でない検索から立った、
 * まだ建てていない候補。地図では灰色の半透明の小さいピンにし、いまの検索の候補だけを目立たせる（Takana の依頼、2026-11-22）。
 * 空いた時間への提案と、建築に失敗したピンは当たらない
 */
export function isPastCandidate(pin: Pick<Pin, 'status' | 'wishId' | 'filler'>, currentWishId: string | null | undefined): boolean {
  return pin.status === 'candidate' && !pin.filler && pin.wishId !== currentWishId
}


/**
 * 前の検索の候補（灰色のピン）を出す距離（km）。地図で見えている所が、まるごとその場所からこの距離の中に収まるまで寄ったら出す。
 * かめの決定（Discord #plus-alpha 2026-11-23。灰色のピンが邪魔で押し間違いの原因になる、という Youkin06 の指摘から）。
 * Discord で決めたのは「半径 30 km」。手元（localhost）で寄り方を試して、かめが 10 km に決めた（2026-11-23）
 */
export const PAST_PIN_RADIUS_KM = 10

/** 2 点のあいだの、地球の表面に沿ったまっすぐな距離（km） */
function distanceKm(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180
  const dLat = (to.lat - from.lat) * rad
  const dLng = (to.lng - from.lng) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/** 見えている所の四隅（corners）が、どれも location から radiusKm 以内か。つまり、見えている所がまるごとその場所の近くに収まっているか */
export function isViewWithin(location: LatLng, corners: readonly LatLng[], radiusKm: number = PAST_PIN_RADIUS_KM): boolean {
  return corners.length > 0 && corners.every((corner) => distanceKm(location, corner) <= radiusKm)
}

/**
 * 地図に出すピンだけを残す（順番はそのまま）。前の検索の候補（灰色のピン）は、見えている所の四隅（corners）がどれも
 * その場所から PAST_PIN_RADIUS_KM 以内のときだけ残す。選んでいるピン（selectedId）は遠くても残す（場所カードを開いているあいだに消さない）。
 * いまの検索の候補、建てたもの、建築に失敗したもの、空いた時間への提案は、距離に関わらず残す。
 * いちばん新しい検索が分からない（currentWishId が undefined）か、見え方がまだない（corners が null）あいだは絞らない
 */
export function pinsInView<T extends Pick<Pin, 'status' | 'wishId' | 'filler' | 'location'> & { id: string }>(
  pins: readonly T[],
  { currentWishId, selectedId, corners }: { currentWishId: string | null | undefined; selectedId: string | null; corners: readonly LatLng[] | null },
): readonly T[] {
  if (currentWishId === undefined || !corners) return pins
  return pins.filter((pin) => pin.id === selectedId || !isPastCandidate(pin, currentWishId) || isViewWithin(pin.location, corners))
}
