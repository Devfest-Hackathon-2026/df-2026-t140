import { runTransaction } from 'firebase/firestore'
import { type Member, memberRef } from '@/entities/member'
import { voteRef } from '@/entities/vote'
import type { Session } from '@/shared/api'

/**
 * 旅から抜ける。投票していたら、票も同じ書き込みで消す（ルールが、票を残したまま抜けることを許さない）。
 * 抜けると、その旅は読めなくなる。招待リンクからもう一度入れる。
 */
export async function leaveTrip(session: Session, tripId: string): Promise<void> {
  const me = memberRef(session.db, tripId, session.uid)
  await runTransaction(session.db, async (transaction) => {
    const snapshot = await transaction.get(me)
    if (!snapshot.exists()) return
    const { votedRouteId } = snapshot.data() as Member
    if (votedRouteId) transaction.delete(voteRef(session.db, tripId, votedRouteId, session.uid))
    transaction.delete(me)
  })
}
