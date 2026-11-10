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
export function newTripData(uid: string, info: TripInfo) {
  return {
    ...normalizeTripInfo(info),
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

/** 基本情報を直す。メンバーなら誰でもできる（状態と決定したルートは Functions だけが書く） */
export async function updateTripInfo(session: Session, tripId: string, info: TripInfo): Promise<void> {
  await updateDoc(tripRef(session.db, tripId), { ...normalizeTripInfo(info), updatedAt: serverTimestamp() })
}
