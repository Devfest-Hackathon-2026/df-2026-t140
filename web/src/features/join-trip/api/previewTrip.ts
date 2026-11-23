import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * 招待された旅の名前を Functions に聞く（functions/src/features/trip-preview）。
 * 参加する前は firestore.rules で旅を読めないので、名前だけを Functions から受け取る。
 * 名前の形が崩れているときは null が返る。
 */
export async function previewTrip(session: Session, tripId: string): Promise<string | null> {
  const result = await httpsCallable<{ tripId: string }, { title: string | null }>(
    session.functions,
    'previewTrip',
  )({ tripId })
  return result.data.title
}
