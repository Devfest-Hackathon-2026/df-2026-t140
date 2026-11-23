import { httpsCallable } from 'firebase/functions'
import type { TravelMode } from '@/entities/trip'
import type { Session } from '@/shared/api'

export type ChangeTravelModeStatus = 'changed' | 'unchanged' | 'not-found'

/** 旅の移動手段を選び直す。しおりの時刻は Functions が一緒に計算し直す（functions/src/features/change-travel-mode） */
export async function changeTravelMode(session: Session, tripId: string, mode: TravelMode): Promise<ChangeTravelModeStatus> {
  const call = httpsCallable<{ tripId: string; mode: TravelMode }, { status: ChangeTravelModeStatus }>(session.functions, 'changeTravelMode')
  const { data } = await call({ tripId, mode })
  return data.status
}
