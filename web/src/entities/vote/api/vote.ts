import { doc, type DocumentReference, type Firestore, serverTimestamp } from 'firebase/firestore'

// 票の置き場所は routes/{routeId}/votes/{uid}。1 人 1 票にするため、ルールは
// 「票と、members/{uid} の votedRouteId が、同じ書き込みの中でそろうこと」を求める。
// だから票だけを単独では書けない。書き込みは features/vote-route（票を入れる・変える）と
// features/leave-trip（抜けるときに票も消す）が、メンバー情報と一緒に行う。
//
// 誰がどの案に投票したかは、members の votedRouteId を見れば分かる（票を別に読まなくてよい）。

export function voteRef(db: Firestore, tripId: string, routeId: string, uid: string): DocumentReference {
  return doc(db, 'trips', tripId, 'routes', routeId, 'votes', uid)
}

/** 票を作るときに書く中身 */
export function newVoteData(uid: string) {
  return { uid, createdAt: serverTimestamp() }
}
