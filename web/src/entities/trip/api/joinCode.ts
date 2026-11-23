import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/** 頼んでいる途中の合言葉（旅の ID → 届く合言葉）。同じ旅で続けて頼んでも、関数は 1 回だけ呼ぶ */
const pending = new Map<string, Promise<string>>()

/**
 * その旅の合言葉を Functions に作ってもらう（functions/src/features/join-code）。
 * もうあれば、同じ合言葉が返る。作った合言葉は旅（trips/{tripId}.joinCode）にも入り、メンバー全員に届く。
 * 旅を作った直後（features/create-trip）に頼み始め、招待の画面（features/invite-friends）が開くころには旅に入っているようにする。
 * 招待の画面が、届く前にもう一度頼んだときは、頼んでいる途中の結果を待つ。失敗したら、次に頼んだときに頼み直す
 */
export function issueJoinCode(session: Session, tripId: string): Promise<string> {
  const known = pending.get(tripId)
  if (known) return known
  const job = httpsCallable<{ tripId: string }, { joinCode: string }>(session.functions, 'issueJoinCode')({ tripId }).then(
    (result) => result.data.joinCode,
    (cause: unknown) => {
      pending.delete(tripId)
      throw cause
    },
  )
  pending.set(tripId, job)
  return job
}
