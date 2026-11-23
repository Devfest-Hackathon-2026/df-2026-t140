import { addDoc, collection, doc, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { type Session, subscribeQuery, withId, type WithId } from '@/shared/api'
import type { MapBounds, Wish } from '../model/types'

/**
 * 「温泉に入りたい」などの希望を書く。bounds は、そのとき地図で映していた範囲（探す範囲）。
 * 場所を探してピンを立てるのは Functions で、端末は status を pending で書くだけ。
 * lodgingNight は、しおりの「宿を探す」から書くときの、何日目の夜の宿か（Functions が宿さがしとして扱う）。
 * mealSlot は、しおりのごはんの枠の「お店を探す」から書くときの、どの日のどのごはんか（「1-lunch」。Functions がお店さがしとして扱う）。
 */
export async function addWish(
  session: Session,
  tripId: string,
  text: string,
  bounds: MapBounds | null,
  lodgingNight?: number,
  mealSlot?: string,
): Promise<string> {
  const wish = await addDoc(collection(session.db, 'trips', tripId, 'wishes'), {
    uid: session.uid,
    text: text.trim(),
    bounds,
    status: 'pending',
    ...(lodgingNight ? { lodgingNight } : {}),
    ...(mealSlot ? { mealSlot } : {}),
    createdAt: serverTimestamp(),
  })
  return wish.id
}

/** 旅の希望を、書かれた順に届ける */
export function subscribeWishes(
  session: Session,
  tripId: string,
  onData: (wishes: WithId<Wish>[], live?: boolean) => void,
  onError: (error: Error) => void,
): () => void {
  return subscribeQuery(
    query(collection(session.db, 'trips', tripId, 'wishes'), orderBy('createdAt')),
    (snapshot, live) => onData(snapshot.docs.map((wish) => withId<Wish>(wish)), live),
    onError,
    doc(session.db, 'trips', tripId),
  )
}
