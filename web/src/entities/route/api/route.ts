import { collection, orderBy, query } from 'firebase/firestore'
import { type Session, subscribeQuery, withId, type WithId } from '@/shared/api'
import type { Route } from '../model/types'

// ルート案を書くのは Functions だけ。端末は読むだけ。

/** 旅のルート案を、ラベル（A、B、C）の順に届ける */
export function subscribeRoutes(
  session: Session,
  tripId: string,
  onData: (routes: WithId<Route>[]) => void,
  onError: (error: Error) => void,
): () => void {
  return subscribeQuery(
    query(collection(session.db, 'trips', tripId, 'routes'), orderBy('label')),
    (snapshot) => onData(snapshot.docs.map((route) => withId<Route>(route))),
    onError,
  )
}
