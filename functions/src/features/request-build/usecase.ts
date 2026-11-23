import { FieldValue } from 'firebase-admin/firestore'
import { BUILT_STATUSES, isStaleBuild, type Pin } from '../../domain/pin'
import { isConfirmed, type Trip } from '../../domain/trip'
import { buildUpdate, decideBuildRequest } from './logic'
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
    const [tripSnapshot, member, pin, built] = await Promise.all([
      tx.get(trip),
      tx.get(trip.collection('members').doc(input.uid)),
      tx.get(pinRef),
      tx.get(trip.collection('pins').where('status', 'in', BUILT_STATUSES)),
    ])
    const data = pin.data() as Pin | undefined
    // 上限に数えるのは、工事中と完成のうち止まっていないもの（#727。画面は止まったピンを失敗として見せるので、数をそろえる）。
    // 頼んだピン自身は logic が見る（止まっていれば 1 つ引く）ので、ここでは除かない
    const nowMs = Date.now()
    const builtCount = built.docs.filter((doc) => doc.id === input.pinId || !isStaleBuild(doc.data() as Pin, nowMs)).length
    const result = decideBuildRequest({
      isMember: member.exists,
      confirmed: isConfirmed((tripSnapshot.data() ?? {}) as Trip),
      pinStatus: data?.status,
      builtCount,
      dismissed: Boolean(data?.filler?.dismissed),
      stale: data ? isStaleBuild(data, nowMs) : false,
    })
    if (result === 'ok') {
      // しおりの空いた時間への提案（features/suggest-fillers）は、「入れる」を押した人のやりたいことにする（#520。logic の buildUpdate）
      tx.update(pinRef, { ...buildUpdate(data ?? {}, input.uid), updatedAt: FieldValue.serverTimestamp() })
    }
    return result
  })
}
