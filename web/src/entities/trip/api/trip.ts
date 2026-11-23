import {
  collection,
  doc,
  type DocumentReference,
  type Firestore,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { type Session, withId, type WithId } from '@/shared/api'
import { normalizeTripInfo, type TripInfo } from '../model/tripInfo'
import type { Trip } from '../model/types'
import type { OriginPoint } from '../model/originPoint'
import { normalizePrefectures, normalizeRegions, type RegionId } from '../model/regions'
import type { TravelMode } from '../model/travelMode'

export function tripRef(db: Firestore, tripId: string): DocumentReference {
  return doc(db, 'trips', tripId)
}

/** これから作る旅の置き場所。ID は推測できない文字列（Firestore の自動 ID）で、招待 URL になる */
export function newTripRef(db: Firestore): DocumentReference {
  return doc(collection(db, 'trips'))
}

/**
 * 旅を作るときに書く中身。旅を作る人は、同じ書き込みで自分をメンバーに入れる必要があるので、
 * 書き込みそのものは features/create-trip が行う。
 */
export function newTripData(
  uid: string,
  info: TripInfo,
  area: { regions: readonly RegionId[]; prefectures: readonly string[] | null },
  originPoint?: OriginPoint,
  travelMode: TravelMode = 'transit',
  returnPoint?: OriginPoint,
) {
  return {
    ...normalizeTripInfo(info),
    regions: normalizeRegions(area.regions),
    ...(area.prefectures ? { prefectures: normalizePrefectures(area.prefectures) } : {}),
    ...(originPoint ? { originPoint } : {}),
    // 帰る場所は出発地と違うときだけ書く（呼ぶ側が決める）
    ...(returnPoint ? { returnTo: returnPoint.name, returnPoint } : {}),
    travelMode,
    status: 'planning' as const,
    decidedRouteId: null,
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

/** 旅が変わるたびに届ける。メンバーでなければ onError が呼ばれる */
export function subscribeTrip(
  session: Session,
  tripId: string,
  onData: (trip: WithId<Trip> | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    tripRef(session.db, tripId),
    (snapshot) => onData(snapshot.exists() ? withId<Trip>(snapshot) : null),
    onError,
  )
}

/**
 * いくつかの旅を、どれかが変わるたびにまとめて届ける（ホームで、計画中の旅と決まったしおりを分けるため）。
 * 全部が 1 回ずつ届いてから届け始める。読めなかった旅（抜けた、消えた）は null
 */
export function subscribeTrips(
  session: Session,
  tripIds: readonly string[],
  onData: (trips: Record<string, WithId<Trip> | null>) => void,
  onError: (error: Error) => void,
): () => void {
  const trips: Record<string, WithId<Trip> | null> = {}
  const pending = new Set(tripIds)
  const deliver = () => {
    if (pending.size === 0) onData({ ...trips })
  }
  if (tripIds.length === 0) onData({})
  const stops = tripIds.map((tripId) =>
    subscribeTrip(
      session,
      tripId,
      (trip) => {
        trips[tripId] = trip
        pending.delete(tripId)
        deliver()
      },
      () => {
        trips[tripId] = null
        pending.delete(tripId)
        deliver()
      },
    ),
  )
  // 1 つの旅が読めなくても、ほかの旅は出す。onError は使わない（形をほかの購読とそろえるために受け取る）
  void onError
  return () => stops.forEach((stop) => stop())
}

/** 旅の名前だけを直す。メンバーなら誰でもできる（確定しているあいだはルールが断る）。確定の直前に名前を決めるときに使う（features/confirm-shiori）。
 * 日程は発案者だけが Functions（change-trip-dates）で変える */
export async function renameTrip(session: Session, tripId: string, title: string): Promise<void> {
  await updateDoc(tripRef(session.db, tripId), { title: title.trim(), updatedAt: serverTimestamp() })
}
