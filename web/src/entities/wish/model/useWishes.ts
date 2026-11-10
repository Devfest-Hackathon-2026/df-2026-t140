import { useSession, type WithId } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { subscribeWishes } from '../api/wish'
import type { Wish } from './types'

/** 旅の希望（書かれた順） */
export function useWishes(tripId: string): Subscribed<WithId<Wish>[]> {
  const session = useSession()
  return useSubscription(`${session.uid}/Wishes/${tripId}`, (onData, onError) =>
    subscribeWishes(session, tripId, onData, onError),
  )
}
