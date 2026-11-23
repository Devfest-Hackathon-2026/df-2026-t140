import { FieldValue } from 'firebase-admin/firestore'
import { AI_ACCESS_COLLECTION } from '../../domain/geminiBudget'
import type { Member } from '../../domain/member'
import { planMemberMove } from './logic'
import type { MoveMembershipsPorts } from './ports'

/**
 * 前の自分（その端末の匿名ログインの人）が参加していた旅と、そこで書いたものを、今の自分へ引き継ぐ。
 * Google アカウントでログインして別の uid になったときに、同じ人が同じ旅に 2 人並ばないようにする。
 * 引き継ぐもの：メンバー情報（名前、色、票）、旅を作った人（createdBy）、希望を書いた人、
 * ピンのもとの希望を書いた人と建築を頼んだ人、合言葉を通した記録（aiAccess）。旅ごとに 1 つのトランザクションで、読む → logic で決める → 書く。
 * 途中で失敗しても、もう一度呼べば残りを引き継ぐ（終わった旅には前の自分がもういない）
 */
export async function moveMemberships(
  ports: MoveMembershipsPorts,
  input: { fromUid: string; toUid: string },
): Promise<number> {
  const { db } = ports
  const { fromUid, toUid } = input
  const memberships = await db.collectionGroup('members').where('uid', '==', fromUid).get()

  let moved = 0
  for (const membership of memberships.docs) {
    const trip = membership.ref.parent.parent
    if (!trip) continue
    const done = await db.runTransaction(async (tx) => {
      const fromRef = trip.collection('members').doc(fromUid)
      const toRef = trip.collection('members').doc(toUid)
      const [from, to, tripDoc, wishes, pins, built] = await Promise.all([
        tx.get(fromRef),
        tx.get(toRef),
        tx.get(trip),
        tx.get(trip.collection('wishes').where('uid', '==', fromUid)),
        tx.get(trip.collection('pins').where('uid', '==', fromUid)),
        tx.get(trip.collection('pins').where('builtBy', '==', fromUid)),
      ])
      if (!from.exists) return false

      const plan = planMemberMove(from.data() as Member, to.data() as Member | undefined, toUid)
      const voteRef = (routeId: string, uid: string) => trip.collection('routes').doc(routeId).collection('votes').doc(uid)
      if (plan.createVoteOf) {
        tx.set(voteRef(plan.createVoteOf, toUid), { uid: toUid, createdAt: FieldValue.serverTimestamp() })
      }
      if (plan.deleteVoteOf) tx.delete(voteRef(plan.deleteVoteOf, fromUid))
      if (plan.create) tx.set(toRef, plan.create)
      tx.delete(fromRef)
      // 旅を作った人が前の自分なら、今の自分にする（発案者が、メンバーにいない人のままにならないように）
      if (tripDoc.data()?.createdBy === fromUid) tx.update(trip, { createdBy: toUid })
      for (const wish of wishes.docs) tx.update(wish.ref, { uid: toUid })
      for (const pin of pins.docs) tx.update(pin.ref, { uid: toUid })
      for (const pin of built.docs) tx.update(pin.ref, { builtBy: toUid })
      return true
    })
    if (done) moved += 1
  }

  // 前の自分が合言葉を通していたら、今の自分も通したことにする（同じ人に 2 回入れさせない）
  const access = await db.collection(AI_ACCESS_COLLECTION).doc(fromUid).get()
  if (access.exists) {
    await db
      .collection(AI_ACCESS_COLLECTION)
      .doc(toUid)
      .set({ uid: toUid, unlockedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  return moved
}
