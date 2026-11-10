import {
  collection,
  collectionGroup,
  doc,
  type DocumentReference,
  type Firestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { type Session, subscribeQuery, withId, type WithId } from '@/shared/api'
import type { Member } from '../model/types'

export function memberRef(db: Firestore, tripId: string, uid: string): DocumentReference {
  return doc(db, 'trips', tripId, 'members', uid)
}

/**
 * 参加するときに書く中身。書き込みそのものは features（create-trip、join-trip）が行う。
 * 票はまだないので votedRouteId は null（ルールがそう決めている）。
 */
export function newMemberData(uid: string, displayName: string, color: string) {
  return { uid, displayName: displayName.trim(), color, votedRouteId: null, joinedAt: serverTimestamp() }
}

/** 旅のメンバーを、参加した順に届ける */
export function subscribeMembers(
  session: Session,
  tripId: string,
  onData: (members: WithId<Member>[], live?: boolean) => void,
  onError: (error: Error) => void,
): () => void {
  return subscribeQuery(
    query(collection(session.db, 'trips', tripId, 'members'), orderBy('joinedAt')),
    (snapshot, live) => onData(snapshot.docs.map((member) => withId<Member>(member)), live),
    onError,
    doc(session.db, 'trips', tripId),
  )
}

/**
 * 自分がその旅のメンバーかどうかを届ける。メンバーでなければ null（参加前でも読める）。
 * サーバーが受け取った状態だけを届ける。参加の書き込みは、サーバーに届く前から手元では「参加済み」に
 * 見えるが、その時点ではまだ旅を読めない（ルールに拒否される）ので、届くまで待つ。
 */
export function subscribeMyMembership(
  session: Session,
  tripId: string,
  onData: (member: WithId<Member> | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    memberRef(session.db, tripId, session.uid),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return
      onData(snapshot.exists() ? withId<Member>(snapshot) : null)
    },
    onError,
  )
}

export interface Membership {
  tripId: string
  member: Member
}

/**
 * 自分が参加している旅を、旅をまたいで集める（旅の一覧用）。新しく参加した順。
 * 匿名ログインなので、端末やブラウザが変わると別の人になり、一覧も変わる。
 */
export function subscribeMyMemberships(
  session: Session,
  onData: (memberships: Membership[]) => void,
  onError: (error: Error) => void,
): () => void {
  // ルールが「自分の分だけ」を求めるので、where は必ず付ける（firestore.indexes.json にインデックスがある）
  return subscribeQuery(
    query(collectionGroup(session.db, 'members'), where('uid', '==', session.uid)),
    (snapshot) => {
      const memberships = snapshot.docs.flatMap((member) => {
        const tripId = member.ref.parent.parent?.id
        const data = member.data({ serverTimestamps: 'estimate' }) as Member
        return tripId ? [{ tripId, member: data }] : []
      })
      memberships.sort((left, right) => right.member.joinedAt.toMillis() - left.member.joinedAt.toMillis())
      onData(memberships)
    },
    onError,
  )
}

/** 自分の表示名や色を直す */
export async function updateMyProfile(
  session: Session,
  tripId: string,
  profile: { displayName?: string; color?: string },
): Promise<void> {
  const patch: { displayName?: string; color?: string } = {}
  if (profile.displayName !== undefined) patch.displayName = profile.displayName.trim()
  if (profile.color !== undefined) patch.color = profile.color
  await updateDoc(memberRef(session.db, tripId, session.uid), patch)
}
