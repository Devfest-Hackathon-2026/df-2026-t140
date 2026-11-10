import { doc, onSnapshot } from 'firebase/firestore'
import type { Session } from '@/shared/api'

/**
 * 自分が合言葉を通しているか（aiAccess/{uid}。書くのは Functions の unlockAi だけ）を届ける。
 * 本人だけが読める（firestore.rules）。ないときは false
 */
export function subscribeMyAiAccess(
  session: Session,
  onData: (unlocked: boolean) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(doc(session.db, 'aiAccess', session.uid), (snapshot) => onData(snapshot.exists()), onError)
}
