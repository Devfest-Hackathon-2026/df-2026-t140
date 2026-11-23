import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

export type SetLodgingStatus = 'changed' | 'unchanged' | 'not-found' | 'confirmed' | 'invalid' | 'decided' | 'no-previous' | 'stale' | 'full'

/**
 * しおりの泊まる夜（night。1 日目の夜が 1）を、宿を取らない夜にする（skip が true。note は自分で書いた過ごし方）か、それを取り消す（false）。
 * same が true なら、その夜を前の夜と同じ宿にする（前の夜の宿の行を複製して、この夜の宿にする）。
 * Functions がルートに書く（functions/src/features/set-lodging）。画面は、ルートの購読で新しい枠を受け取る
 */
export async function setLodging(
  session: Session,
  input: { tripId: string; routeId: string; night: number; skip?: boolean; note?: string | null; same?: true },
): Promise<SetLodgingStatus> {
  const call = httpsCallable<typeof input, { status: SetLodgingStatus }>(session.functions, 'setLodging')
  const { data } = await call(input)
  return data.status
}
