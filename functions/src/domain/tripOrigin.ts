import { originLocation } from './originPlaces'
import type { LatLng } from './pin'
import type { Trip } from './trip'
import { travelModeOf } from './travelMode'

export interface OriginPoint {
  name: string
  location: LatLng
  placeId: string | null
}

export function validLocation(value: unknown): value is LatLng {
  const point = value as LatLng | null
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
}

/**
 * しおりを計算するときの出発の条件（出発地と、旅の移動手段と、旅の開始日）。名前を変えたあとに古い位置を使わない。以前の旅は既存の地名表で扱う。
 * 開始日は、時刻が決まったイベントを開催日の日に置くのに使う（domain/routePlan.ts の buildPlan。#581）。
 * 帰る場所（returnTo）があれば、旅の最後に帰る移動の目安はそこまでで見る（returnLocation。ないか位置が分からなければ出発地）
 */
export function tripOrigin(
  trip: Pick<Trip, 'origin' | 'originPoint' | 'travelMode'> & Partial<Pick<Trip, 'startDate' | 'returnTo' | 'returnPoint'>>,
) {
  const point = trip.originPoint
  const goal = trip.returnPoint
  const returnLocation =
    trip.returnTo && trip.returnTo !== trip.origin
      ? goal?.name === trip.returnTo && validLocation(goal.location) ? goal.location : originLocation(trip.returnTo)
      : null
  return {
    name: trip.origin,
    location: point?.name === trip.origin && validLocation(point.location) ? point.location : originLocation(trip.origin),
    ...(returnLocation ? { returnLocation } : {}),
    travelMode: travelModeOf(trip),
    ...(typeof trip.startDate === 'string' ? { startDate: trip.startDate } : {}),
  }
}
