import { writeBatch } from 'firebase/firestore'
import { colorForUid, memberRef, newMemberData } from '@/entities/member'
import { newTripData, newTripRef, type TripInfo } from '@/entities/trip'
import type { Session } from '@/shared/api'

/**
 * 旅を作り、作った人を最初のメンバーにする。旅の ID を返す（招待 URL になる）。
 * 2 つを 1 回の書き込みにするのは、ルールが「作る人は必ずメンバー」を求めるため。
 * 作った人に特別な権限はない（幹事に集中させない）。
 */
export async function createTrip(session: Session, info: TripInfo, displayName: string): Promise<string> {
  const trip = newTripRef(session.db)
  const batch = writeBatch(session.db)
  batch.set(trip, newTripData(session.uid, info))
  batch.set(
    memberRef(session.db, trip.id, session.uid),
    newMemberData(session.uid, displayName, colorForUid(session.uid)),
  )
  await batch.commit()
  return trip.id
}
