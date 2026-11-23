// 同じ場所を旅の中で何度も訪れるしおりの、行の ID の決め（企画書「ユーザー体験」3-6、#528）。
// Functions 側は functions/src/domain/visit.ts。片方を変えたら、もう片方も合わせる。
// しおりの行の ID は、その場所の 1 つ目の行はピンの ID そのまま、複製した行は「ピンの ID~番号」。
// 時刻を直す、区間の手段を選ぶ、順番を入れ替える、場所の情報を開くときは、行の ID で指す
import type { RouteStop } from './types'

/** ピンの ID と番号のあいだの印 */
const VISIT_MARK = '~'

/** 行の ID から、その場所のピンの ID */
export function pinOfStop(stopId: string): string {
  const at = stopId.indexOf(VISIT_MARK)
  return at < 0 ? stopId : stopId.slice(0, at)
}

/** しおりの行の ID。複製した行は stopId、ほかの場所の行はピンの ID。集合場所の行（ピンがない）は null */
export function stopIdOf(stop: Pick<RouteStop, 'pinId' | 'stopId'>): string | null {
  return stop.pinId ? (stop.stopId ?? stop.pinId) : null
}

/** しおりで、その場所の行がいくつあるか（ピンの ID ごと） */
export function visitCounts(schedule: readonly Pick<RouteStop, 'pinId'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const stop of schedule) if (stop.pinId) counts.set(stop.pinId, (counts.get(stop.pinId) ?? 0) + 1)
  return counts
}
