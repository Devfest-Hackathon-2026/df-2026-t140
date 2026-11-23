import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * 旅の合言葉を Functions に送り、その旅の ID を受け取る（functions/src/features/join-code）。
 * 参加はまだしない。受け取った旅の画面を開くと、参加の画面（名前を入れる画面）になる。
 * 断られたときは、理由の文（日本語）が入ったエラーが投げられる。
 */
export async function findTripByJoinCode(session: Session, joinCode: string): Promise<string> {
  const result = await httpsCallable<{ joinCode: string }, { tripId: string }>(
    session.functions,
    'findTripByJoinCode',
  )({ joinCode })
  return result.data.tripId
}
