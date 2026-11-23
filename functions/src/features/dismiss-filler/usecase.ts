import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { isOpenFiller, type Pin } from '../../domain/pin'

export type DismissFillerResult = 'dismissed' | 'not-member' | 'not-found'

/**
 * しおりの空いた時間への提案を「無視」する（#520）。ピンに無視の印を付けるだけで、消さない
 * （同じ場所を二度と提案しないため。features/suggest-fillers は、旅のピンと同じ名前の場所を選ばない）。
 * メンバーなら誰でもできる（全員が主人公。提案を入れるのと同じ）。もう建てた・無視した提案は、何もしない（dismissed を返す）
 */
export async function dismissFiller(ports: { db: Firestore }, input: { tripId: string; pinId: string; uid: string }): Promise<DismissFillerResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const pinRef = tripRef.collection('pins').doc(input.pinId)
  return db.runTransaction(async (tx) => {
    const [member, pinSnapshot] = await Promise.all([tx.get(tripRef.collection('members').doc(input.uid)), tx.get(pinRef)])
    if (!member.exists) return 'not-member'
    const pin = pinSnapshot.data() as Pin | undefined
    if (!pin?.filler) return 'not-found'
    if (!isOpenFiller(pin)) return 'dismissed'
    tx.update(pinRef, { filler: { ...pin.filler, dismissed: true }, updatedAt: FieldValue.serverTimestamp() })
    return 'dismissed'
  })
}
