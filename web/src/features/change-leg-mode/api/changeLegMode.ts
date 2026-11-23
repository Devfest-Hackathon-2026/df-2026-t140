import { httpsCallable } from 'firebase/functions'
import type { LegMode } from '@/entities/route'
import type { Session } from '@/shared/api'

export type ChangeLegModeStatus = 'changed' | 'not-found' | 'stale' | 'too-far' | 'too-near'

/**
 * しおりの区間（from → to）の手段を選び直す。mode が null なら旅全体の手段に戻す。
 * しおりの時刻は Functions が一緒に組み直す（functions/src/features/change-leg-mode）
 */
export async function changeLegMode(
  session: Session,
  input: { tripId: string; routeId: string; from: string; to: string; mode: LegMode | null },
): Promise<ChangeLegModeStatus> {
  const call = httpsCallable<typeof input, { status: ChangeLegModeStatus }>(session.functions, 'changeLegMode')
  const { data } = await call(input)
  return data.status
}
