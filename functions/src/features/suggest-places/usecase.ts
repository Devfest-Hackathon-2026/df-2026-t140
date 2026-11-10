import { FieldValue } from 'firebase-admin/firestore'
import { decideAiGate } from '../../domain/geminiBudget'
import type { Pin } from '../../domain/pin'
import type { Wish } from '../../domain/wish'
import type { GeminiPermit } from '../../ports/gemini'
import { candidatePinId, pickCandidates } from './logic'
import type { SuggestPlacesPorts } from './ports'
import { suggestPlacesTask } from './prompt'

export interface SuggestPlacesOptions {
  /**
   * 今の Gemini の経路に費用がかかる（vertex）か。true なら、呼ぶ前に関所（aiGate）を通し、
   * 通ったときだけ印（GeminiPermit）を付ける。false（stub、agy）なら関所は見ない
   */
  guarded: boolean
}

/**
 * 希望 1 つから、候補のピンを立てる。読む → logic で決める → 書く。
 *
 * 同じイベントが 2 回届いても、ピンが 2 倍にならないようにしてある：
 * - 最初にトランザクションで status を pending → searching にする。2 回目は pending ではないので何もしない
 * - ピンの ID は「希望の ID ＋ 順番」で決まるので、同じ内容で書き直しても増えない
 *
 * 費用：経路が vertex のときは、希望を書いた人が合言葉を通していて（aiAccess/{uid}）、Flash の累計が上限の中
 * （usage/flash）のときだけ印を付ける。印がなければ呼び出し口が固定の応答に戻す（design-principles の cost/gemini-guarded）
 */
export async function suggestPlacesForWish(
  ports: SuggestPlacesPorts,
  tripId: string,
  wishId: string,
  options: SuggestPlacesOptions = { guarded: false },
): Promise<void> {
  const { db, gemini } = ports
  const trip = db.collection('trips').doc(tripId)
  const wishRef = trip.collection('wishes').doc(wishId)

  // Gemini を呼ぶ前に「自分が引き受けた」と書く
  const wish = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(wishRef)
    const data = snapshot.data() as Wish | undefined
    if (!data || data.status !== 'pending') return null
    tx.update(wishRef, { status: 'searching' })
    return data
  })
  if (!wish) return

  try {
    const existing = await trip.collection('pins').select('name').get()
    const exclude = existing.docs.map((pin) => String(pin.get('name')))

    const permit = options.guarded ? await permitFor(ports, wish.uid, wishId) : undefined
    const result = await gemini.run(suggestPlacesTask, { text: wish.text, bounds: wish.bounds, exclude }, { permit })
    const places = pickCandidates(result.output, exclude)

    const batch = db.batch()
    places.forEach((place, index) => {
      const pin: Omit<Pin, 'createdAt' | 'updatedAt'> = {
        wishId,
        uid: wish.uid,
        name: place.name,
        description: place.description,
        area: place.area,
        category: place.category,
        location: place.location,
        status: 'candidate',
        suggestedBy: result.provider,
        placeId: null,
        builtBy: null,
        buildStartedAt: null,
      }
      batch.set(trip.collection('pins').doc(candidatePinId(wishId, index)), {
        ...pin,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    batch.update(wishRef, { status: places.length > 0 ? 'done' : 'failed' })
    await batch.commit()
  } catch (cause) {
    console.error(`希望 ${tripId}/${wishId} の場所を探せませんでした`, cause)
    await wishRef.update({ status: 'failed' })
  }
}

/**
 * 関所を通す（テストのために export する）。合言葉を通していない人の希望では回数を消費しない（先に unlocked を見る）。
 * 全員に開く切り替え（settings/ai）が入っていれば、合言葉は見ない
 */
export async function permitFor(ports: Pick<SuggestPlacesPorts, 'aiGate'>, uid: string, wishId: string): Promise<GeminiPermit | undefined> {
  const unlocked = (await ports.aiGate.isOpenToAll()) || (await ports.aiGate.isUnlocked(uid))
  const reserved = unlocked ? await ports.aiGate.reserveFlashCall() : false
  const decision = decideAiGate({ unlocked, reserved })
  if (decision !== 'ok') {
    console.info(`希望 ${wishId}：本物の Gemini は使わず固定の応答にします（${decision}）`)
    return undefined
  }
  return { uid, refund: () => ports.aiGate.refundFlashCall() }
}
