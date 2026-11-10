import type { LatLng, Pin } from '../../domain/pin'
import { distanceKm } from '../../domain/routePlan'

/**
 * 推測した位置から、見つかった場所までの許せる遠さ（km）。これより遠ければ、同じ名前の別の場所とみなして直さない。
 * 推測の位置がずれていることがある（#152）ので、Places の locationBias の半径（50 km）より少し広くとる
 */
export const MAX_SHIFT_KM = 80

/**
 * ピンの更新が「工事中になった瞬間」で、まだ Places で確かめていないか。
 * 自分が書いた位置の更新や、build-model の更新でもう一度呼ばれても、状態が変わっていないので繰り返さない
 */
export function shouldVerify(
  before: Pick<Pin, 'status'> | undefined,
  after: Pick<Pin, 'status' | 'placeId' | 'builtBy'> | undefined,
): boolean {
  if (!after || after.status !== 'building') return false
  if (before?.status === 'building') return false
  return !after.placeId && typeof after.builtBy === 'string' && after.builtBy.length > 0
}

/** 見つかった場所を採るか。推測した位置から遠すぎるものは採らない */
export function acceptFound(guess: LatLng, found: LatLng, maxKm: number = MAX_SHIFT_KM): boolean {
  return distanceKm(guess, found) <= maxKm
}

/** Places に聞く文（domain/pin.ts の placeQuery。候補の口コミ features/place-reviews でも使うので domain に置いた） */
export { placeQuery } from '../../domain/pin'
