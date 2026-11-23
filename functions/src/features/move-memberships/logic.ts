import type { Member } from '../../domain/member'

// SDK を import しない純粋な判断。前の自分（匿名）のメンバー情報を、今の自分（Google アカウント）へどう引き継ぐか。

export interface MemberMove {
  /** 今の自分のメンバー情報として新しく書くもの。もう参加していれば null（今の自分の名前と色を残す） */
  create: Member | null
  /** 消す票（前の自分の票）のルート。なければ null */
  deleteVoteOf: string | null
  /** 今の自分の票として作り直すルート。なければ null */
  createVoteOf: string | null
}

/**
 * 1 つの旅で、前の自分のメンバー情報を今の自分へ引き継ぐ。
 * 今の自分がまだ参加していなければ、名前、色、参加した時刻、票をそのまま受け取る。
 * もう参加していれば、今の自分のものを残し、前の自分の票は消す（1 人 1 票のまま）
 */
export function planMemberMove(from: Member, to: Member | undefined, toUid: string): MemberMove {
  if (to) return { create: null, deleteVoteOf: from.votedRouteId, createVoteOf: null }
  return {
    create: { ...from, uid: toUid },
    deleteVoteOf: from.votedRouteId,
    createVoteOf: from.votedRouteId,
  }
}
