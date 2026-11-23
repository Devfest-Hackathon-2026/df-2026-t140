import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { isStaleBuild, type Pin } from '../../domain/pin'
import { openLodgingNights, type Route, SHIORI_ROUTE_ID } from '../../domain/route'
import { tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { memberJoin, ownerUid } from '../../domain/tripOwner'
import { decideConfirm } from './logic'

export interface ConfirmShioriInput {
  tripId: string
  uid: string
  /** 確定するなら true、取り消すなら false */
  confirm: boolean
}

export type ConfirmShioriResult =
  | { status: 'confirmed' | 'unconfirmed' }
  | { status: 'not-member' | 'not-found' | 'not-owner' | 'empty' | 'building' | 'lodging' }

/**
 * 旅程を確定する・取り消す。読む → logic で決める → 書く（企画書「ユーザー体験」3-6）。
 * 確定すると旅に確定の印（confirmed）を付け、取り消すと消す。しおりの中身は写さず、変えない（止めるのは、ほかの機能が印を見て断る）。
 * 発案者は、今いるメンバーのうち、いちばん早く入った人（domain/tripOwner.ts）。外の API は呼ばない
 */
export async function confirmShiori(ports: { db: Firestore }, input: ConfirmShioriInput): Promise<ConfirmShioriResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  return db.runTransaction(async (tx): Promise<ConfirmShioriResult> => {
    const [tripSnapshot, membersSnapshot, pinsSnapshot] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('members')),
      tx.get(tripRef.collection('pins').where('status', 'in', ['building', 'done'])),
    ])
    const trip = tripSnapshot.data() as Trip | undefined
    // しおりのルート（前の形で決定になった旅は、決定したルート）。建った場所がそろって入っているかを見る
    const routeId = trip?.status === 'decided' && trip.decidedRouteId ? trip.decidedRouteId : SHIORI_ROUTE_ID
    const routeSnapshot = await tx.get(tripRef.collection('routes').doc(routeId))
    const route = routeSnapshot.data() as Route | undefined
    // 日程を縮めてしおりから外した場所（leftOutPinIds）は、入っているものとして数える（入りきらなかった場所として、外したまま確定できる）
    const listed = new Set([...(route?.pinIds ?? []), ...(route?.leftOutPinIds ?? [])])
    const members = membersSnapshot.docs.map((doc) => memberJoin(doc.id, doc.data()))
    // 工事中のまま止まったピン（#727。domain/pin.ts の isStaleBuild）は、失敗したものとして数えず、確定するときに「失敗」と書く
    const nowMs = Date.now()
    const staleDocs = pinsSnapshot.docs.filter((doc) => isStaleBuild(doc.data() as Pin, nowMs))
    const staleIds = new Set(staleDocs.map((doc) => doc.id))
    const statuses = pinsSnapshot.docs.filter((doc) => !staleIds.has(doc.id)).map((doc) => (doc.data() as Pin).status)
    const decision = decideConfirm({
      isMember: members.some((member) => member.uid === input.uid),
      isOwner: ownerUid(members) === input.uid,
      tripExists: Boolean(trip),
      confirm: input.confirm,
      doneCount: statuses.filter((status) => status === 'done').length,
      buildingCount: statuses.filter((status) => status === 'building').length,
      // 宿の建物も、宿を取らないことも決めていない夜が残っていれば、確定しない
      openLodgingCount: trip ? openLodgingNights({ pinIds: route?.pinIds ?? [], lodging: route?.lodging }, tripDays(trip.startDate, trip.endDate)).length : 0,
      unlistedCount: pinsSnapshot.docs.filter((doc) => (doc.data() as Pin).status === 'done' && !listed.has(doc.id)).length,
    })
    if (decision === 'confirm') {
      if (!isConfirmed(trip!)) {
        tx.update(tripRef, { confirmed: { uid: input.uid, at: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() })
      }
      for (const doc of staleDocs) tx.update(doc.ref, { status: 'failed', updatedAt: FieldValue.serverTimestamp() })
      return { status: 'confirmed' }
    }
    if (decision === 'unconfirm') {
      if (isConfirmed(trip!)) tx.update(tripRef, { confirmed: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
      return { status: 'unconfirmed' }
    }
    return { status: decision }
  })
}
