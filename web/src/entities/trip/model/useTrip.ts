import { useSession, type WithId } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { subscribeTrip } from '../api/trip'
import type { Trip } from './types'

/** 旅を読み、変わるたびに描き直す。旅がなければ data は null */
export function useTrip(tripId: string): Subscribed<WithId<Trip> | null> {
  const session = useSession()
  return useSubscription(`${session.uid}/Trip/${tripId}`, (onData, onError) =>
    subscribeTrip(session, tripId, onData, onError),
  )
}
