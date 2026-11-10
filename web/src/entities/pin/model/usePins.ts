import { useSession, type WithId } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { subscribePins } from '../api/pin'
import type { Pin } from './types'

/** 旅のピン（立った順） */
export function usePins(tripId: string): Subscribed<WithId<Pin>[]> {
  const session = useSession()
  return useSubscription(`${session.uid}/Pins/${tripId}`, (onData, onError) =>
    subscribePins(session, tripId, onData, onError),
  )
}
