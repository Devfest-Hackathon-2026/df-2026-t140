import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/** Functions の答え。changed のほかは、足せなかった・消せなかった理由（functions/src/features/repeat-visit/types.ts） */
export type RepeatVisitStatus = 'changed' | 'stale' | 'full' | 'last'

/**
 * しおりの行のすぐ下に同じ場所の行を足す（remove が false）、または同じ場所の行を 1 つ消す（remove が true）。
 * 同じ場所を旅の中で何度も訪れられるようにする（functions/src/features/repeat-visit。#528）。
 * Functions が時刻と日を計算し直して保存する。画面は、ルートの購読で新しいしおりを受け取る。
 * 断られたとき（メンバーでない、しおりがない）は、エラーが投げられる
 */
export async function repeatVisit(session: Session, tripId: string, routeId: string, stopId: string, remove: boolean): Promise<RepeatVisitStatus> {
  const result = await httpsCallable<unknown, { status: RepeatVisitStatus }>(session.functions, 'repeatVisit')({ tripId, routeId, stopId, remove })
  return result.data.status
}
