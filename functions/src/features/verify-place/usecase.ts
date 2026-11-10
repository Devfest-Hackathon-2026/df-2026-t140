import { FieldValue } from 'firebase-admin/firestore'
import type { Pin } from '../../domain/pin'
import { acceptFound, placeQuery } from './logic'
import type { VerifyPlacePorts } from './ports'

export type VerifyPlaceResult = 'skipped' | 'not-found' | 'too-far' | 'moved'

/**
 * 「工事中」になった場所を Places で確かめ、見つかれば位置と placeId を直す。読む → logic で決める → 書く。
 * 呼ぶのは、Places を呼べる設定で、建てた人が合言葉を通しているか、全員に開く切り替えが入っているときだけ。
 * 書くのは location と placeId だけ。名前・説明は Gemini（か見本の一覧）が書いたまま（模型の入力は Maps 由来にしない。規約 3.2.3(c)）
 */
export async function verifyPlaceForPin(
  ports: VerifyPlacePorts,
  tripId: string,
  pinId: string,
): Promise<VerifyPlaceResult> {
  if (!ports.placesApi.enabled()) return 'skipped'
  const pinRef = ports.db.collection('trips').doc(tripId).collection('pins').doc(pinId)
  const pin = (await pinRef.get()).data() as Pin | undefined
  if (!pin || pin.placeId || !pin.builtBy) return 'skipped'
  const allowed = (await ports.aiGate.isOpenToAll()) || (await ports.aiGate.isUnlocked(pin.builtBy))
  if (!allowed) {
    console.info(`ピン ${pinId}：建てた人が合言葉を通していないので、Places では確かめません`)
    return 'skipped'
  }

  const found = await ports.placesApi.findPlace({ text: placeQuery(pin), near: pin.location })
  if (!found) {
    console.info(`ピン ${pinId}：Places で見つからなかったので、位置はそのままにします`)
    return 'not-found'
  }
  if (!acceptFound(pin.location, found.location)) {
    console.info(`ピン ${pinId}：見つかった場所が推測の位置から遠すぎるので、位置はそのままにします`)
    return 'too-far'
  }
  // 確かめるあいだに別の人が位置を変えていても、ここで書くのは Places の位置。ピンが消えていたら書かない
  await ports.db.runTransaction(async (tx) => {
    const latest = await tx.get(pinRef)
    if (!latest.exists || (latest.data() as Pin).placeId) return
    tx.update(pinRef, { location: found.location, placeId: found.placeId, updatedAt: FieldValue.serverTimestamp() })
  })
  return 'moved'
}
