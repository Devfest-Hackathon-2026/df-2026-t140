import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

export type SetStopTimeStatus = 'changed' | 'not-found' | 'stale' | 'clash'

/** 時刻を直した結果。clash なら、まだ変わっていない。names は、時間が重なる時刻の決まったイベントの名前（#581） */
export interface SetStopTimeResult {
  status: SetStopTimeStatus
  names?: string[]
}

/**
 * しおりの時刻（集合時間は @meet、出発時間は @origin、場所に着く時刻はピンの ID）を minutes（0 時からの分）にする。
 * Functions がしおりを組み直して保存する（functions/src/features/set-stop-time）。画面は、ルートの購読で新しいしおりを受け取る。
 * 直すと時刻が決まったイベントの時間と重なるときは、変えずに clash を返す。人が確かめたら force を付けて呼び直す
 */
export async function setStopTime(
  session: Session,
  input: { tripId: string; routeId: string; key: string; minutes: number; force?: boolean },
): Promise<SetStopTimeResult> {
  const call = httpsCallable<typeof input, SetStopTimeResult>(session.functions, 'setStopTime')
  const { data } = await call(input)
  return { status: data.status, ...(Array.isArray(data.names) ? { names: data.names } : {}) }
}
