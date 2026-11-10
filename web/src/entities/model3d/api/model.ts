import { doc, getDoc } from 'firebase/firestore'
import type { Session } from '@/shared/api'
import type { StoredModel } from '../model/types'

/**
 * 建物（完成したピン）の模型を読む。まだなければ null。
 * 模型の JSON は大きいので、ピンの一覧には入れず、描くときに 1 回だけ読む。書くのは Functions だけ。
 */
export async function getStoredModel(session: Session, tripId: string, pinId: string): Promise<StoredModel | null> {
  const snapshot = await getDoc(doc(session.db, 'trips', tripId, 'pins', pinId, 'model', 'current'))
  return snapshot.exists() ? (snapshot.data() as StoredModel) : null
}
