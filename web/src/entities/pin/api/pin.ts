import { collection, doc, orderBy, query } from 'firebase/firestore'
import { type Session, subscribeQuery, withId, type WithId } from '@/shared/api'
import type { Pin } from '../model/types'

// ピンと模型を書くのは Functions だけ（AI の結果を改ざんさせない）。端末は読むだけ。
// 模型（pins/{pinId}/model/current）を読むのは entities/model3d。

/** 旅のピンを、立った順に届ける。状態（候補、工事中、完成、失敗）が変わるたびに届く */
export function subscribePins(
  session: Session,
  tripId: string,
  onData: (pins: WithId<Pin>[], live?: boolean) => void,
  onError: (error: Error) => void,
): () => void {
  return subscribeQuery(
    query(collection(session.db, 'trips', tripId, 'pins'), orderBy('createdAt')),
    (snapshot, live) => onData(snapshot.docs.map((pin) => withId<Pin>(pin)), live),
    onError,
    doc(session.db, 'trips', tripId),
  )
}
