import { useSession, type WithId } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { subscribeRoutes } from '../api/route'
import type { Route } from './types'

/** 旅のルート案（ラベルの順） */
export function useRoutes(tripId: string): Subscribed<WithId<Route>[]> {
  const session = useSession()
  return useSubscription(`${session.uid}/Routes/${tripId}`, (onData, onError) =>
    subscribeRoutes(session, tripId, onData, onError),
  )
}
