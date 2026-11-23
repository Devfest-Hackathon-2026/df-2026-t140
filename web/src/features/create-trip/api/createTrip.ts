import { writeBatch } from 'firebase/firestore'
import { colorForUid, memberRef, newMemberData } from '@/entities/member'
import { newTripData, newTripRef, type OriginPoint, type RegionId, type TravelMode, type TripInfo } from '@/entities/trip'
import type { Session } from '@/shared/api'

/**
 * 旅を作り、作った人を最初のメンバーにする。旅の ID を返す（招待 URL になる）。
 * 2 つを 1 回の書き込みにするのは、ルールが「作る人は必ずメンバー」を求めるため。
 * area は、作った人（発案者）が選んだ大まかな場所（地方と、県まで絞ったときの県）。
 * returnPoint は、旅の最後にいたい場所が出発地と違うときだけ渡す（同じなら出発地へ帰る）。
 */
export async function createTrip(
  session: Session,
  info: TripInfo,
  area: { regions: readonly RegionId[]; prefectures: readonly string[] | null },
  displayName: string,
  originPoint: OriginPoint | undefined,
  travelMode: TravelMode,
  returnPoint?: OriginPoint,
): Promise<string> {
  const trip = newTripRef(session.db)
  const batch = writeBatch(session.db)
  batch.set(trip, newTripData(session.uid, info, area, originPoint, travelMode, returnPoint))
  batch.set(
    memberRef(session.db, trip.id, session.uid),
    newMemberData(session.uid, displayName, colorForUid(session.uid)),
  )
  await batch.commit()
  return trip.id
}
