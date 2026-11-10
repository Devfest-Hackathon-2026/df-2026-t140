import { useSession, type WithId } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { type Membership, subscribeMembers, subscribeMyMembership, subscribeMyMemberships } from '../api/member'
import type { Member } from './types'

/** 旅のメンバー（参加した順） */
export function useMembers(tripId: string): Subscribed<WithId<Member>[]> {
  const session = useSession()
  return useSubscription(`${session.uid}/Members/${tripId}`, (onData, onError) =>
    subscribeMembers(session, tripId, onData, onError),
  )
}

/** 自分がその旅のメンバーか。メンバーでなければ data は null */
export function useMyMembership(tripId: string): Subscribed<WithId<Member> | null> {
  const session = useSession()
  return useSubscription(`${session.uid}/MyMembership/${tripId}`, (onData, onError) =>
    subscribeMyMembership(session, tripId, onData, onError),
  )
}

/** 自分が参加している旅（新しく参加した順） */
export function useMyMemberships(): Subscribed<Membership[]> {
  const session = useSession()
  return useSubscription(`${session.uid}/MyMemberships`, (onData, onError) =>
    subscribeMyMemberships(session, onData, onError),
  )
}
