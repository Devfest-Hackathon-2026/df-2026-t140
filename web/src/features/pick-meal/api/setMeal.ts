import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

export type SetMealStatus = 'changed' | 'unchanged' | 'not-found' | 'confirmed' | 'invalid' | 'decided'

/**
 * しおりのごはんの枠（slot。「1-lunch」）を、お店を建てずに決める（skip が true。note は書いた言葉）か、それを取り消す（false）。
 * Functions がルートに書く（functions/src/features/set-meal）。画面は、ルートの購読で新しい枠を受け取る
 */
export async function setMeal(
  session: Session,
  input: { tripId: string; routeId: string; slot: string; skip: boolean; note?: string | null },
): Promise<SetMealStatus> {
  const call = httpsCallable<typeof input, { status: SetMealStatus }>(session.functions, 'setMeal')
  const { data } = await call(input)
  return data.status
}
