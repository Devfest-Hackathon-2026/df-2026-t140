import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import { originProblem, type OriginPoint } from '../model/originPoint'

export async function resolveOrigin(session: Session, name: string): Promise<OriginPoint> {
  const call = httpsCallable<{ name: string }, { status: string; point?: OriginPoint }>(session.functions, 'resolveOrigin')
  const { data } = await call({ name })
  if (data.status !== 'resolved' || !data.point) throw new Error(originProblem(data.status))
  return data.point
}

/** 出発地を引いた結果。resolved のときは位置がある。見つからない・まだ探せないときは、その理由 */
export type OriginLookup = { status: 'resolved'; point: OriginPoint } | { status: 'not-found' | 'unavailable' }

/**
 * 出発地の名前から位置を引く（旅をつくる画面で、入力して決定を押したとき）。resolveOrigin と同じ関数を呼ぶが、
 * 見つからなくても例外にせず、理由を返す（画面に一言で出す）。表にある名前は関数の中で API を呼ばない
 */
export async function lookupOrigin(session: Session, name: string): Promise<OriginLookup> {
  const call = httpsCallable<{ name: string }, { status: string; point?: OriginPoint }>(session.functions, 'resolveOrigin')
  const { data } = await call({ name })
  if (data.status === 'resolved' && data.point) return { status: 'resolved', point: data.point }
  return { status: data.status === 'unavailable' ? 'unavailable' : 'not-found' }
}

export async function changeOrigin(session: Session, tripId: string, name: string, expectedOrigin: string) {
  const call = httpsCallable<{ tripId: string; name: string; expectedOrigin: string }, { status: string }>(session.functions, 'changeOrigin')
  const { data } = await call({ tripId, name, expectedOrigin })
  if (data.status !== 'changed') throw new Error(originProblem(data.status))
}
