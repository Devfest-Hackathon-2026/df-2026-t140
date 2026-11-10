import { useSession } from '@/shared/api'
import { type Subscribed, useSubscription } from '@/shared/lib'
import { subscribeMyAiAccess } from '../api/aiAccess'

/** 自分が合言葉を通していて、本物の AI を使えるか */
export function useMyAiAccess(): Subscribed<boolean> {
  const session = useSession()
  return useSubscription(`${session.uid}/MyAiAccess`, (onData, onError) => subscribeMyAiAccess(session, onData, onError))
}
