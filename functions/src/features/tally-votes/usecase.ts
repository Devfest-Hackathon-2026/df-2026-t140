import { FieldValue } from 'firebase-admin/firestore'
import type { Member } from '../../domain/member'
import type { Route } from '../../domain/route'
import type { Trip } from '../../domain/trip'
import { decideRoute } from './logic'
import type { TallyVotesPorts } from './ports'

/**
 * 全員が投票していたら、いちばん票の多いルートに決め、旅を「決定」にする。読む → logic で決める → 書く。
 * 決めるのは、ここ（Functions）だけ。端末は、旅の状態と決まったルートを書けない（firestore.rules）。
 *
 * 1 つのトランザクションで、旅、ルート案、メンバーを読んで決める。同じイベントが 2 回届いても、
 * 2 回目は旅がもう「決定」なので何もしない。決まったあとは、ルールが票の変更を拒むので、結果は変わらない。
 *
 * 返すのは、決まったルートの ID。決まらなかった（まだ全員が投票していない、もう決まっている）なら null。
 */
export async function tallyVotes(ports: TallyVotesPorts, tripId: string): Promise<string | null> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(tripId)
  return db.runTransaction(async (tx) => {
    const [trip, routes, members] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('routes')),
      tx.get(tripRef.collection('members')),
    ])
    if ((trip.data() as Trip | undefined)?.status !== 'planning') return null
    const decided = decideRoute({
      routes: routes.docs.map((snapshot) => ({ id: snapshot.id, label: (snapshot.data() as Route).label })),
      votes: members.docs.map((snapshot) => (snapshot.data() as Member).votedRouteId ?? null),
    })
    if (!decided) return null
    tx.update(tripRef, { status: 'decided', decidedRouteId: decided, updatedAt: FieldValue.serverTimestamp() })
    return decided
  })
}
