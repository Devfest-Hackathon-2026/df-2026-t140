import { FieldValue } from 'firebase-admin/firestore'
import { BUILT_STATUSES, type Pin } from '../../domain/pin'
import { decideBuildRequest } from './logic'
import type { RequestBuildPorts } from './ports'
import type { RequestBuildResult } from './types'

/**
 * 「建築する！」の依頼を受け、ピンを「工事中」にする。読む → logic で決める → 書く。
 * 模型は作らない。「工事中」になったのを features/build-model のトリガーが見て、裏で作る
 * （機能どうしは直接呼ばず、Firestore の状態でつなぐ）。
 *
 * 上限の確認と書き込みは 1 つのトランザクションにする。2 人が同時に 20 棟目と 21 棟目を頼んでも、
 * 片方だけが通る。
 */
export async function requestBuild(
  ports: RequestBuildPorts,
  input: { tripId: string; pinId: string; uid: string },
): Promise<RequestBuildResult> {
  const { db } = ports
  const trip = db.collection('trips').doc(input.tripId)
  const pinRef = trip.collection('pins').doc(input.pinId)

  return db.runTransaction(async (tx) => {
    const [member, pin, built] = await Promise.all([
      tx.get(trip.collection('members').doc(input.uid)),
      tx.get(pinRef),
      tx.get(trip.collection('pins').where('status', 'in', BUILT_STATUSES)),
    ])
    const result = decideBuildRequest({
      isMember: member.exists,
      pinStatus: (pin.data() as Pin | undefined)?.status,
      builtCount: built.size,
    })
    if (result === 'ok') {
      tx.update(pinRef, {
        status: 'building',
        builtBy: input.uid,
        buildStartedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    return result
  })
}
