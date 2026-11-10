import { BUILD_LIMIT_PER_TRIP, canRequestBuild, type PinStatus } from '../../domain/pin'
import type { RequestBuildResult } from './types'

// 建築の依頼を受けるかどうかの純粋な判断（scripts/functions.test.mjs で確かめる）。

export interface BuildRequestFacts {
  /** 頼んだ人が旅のメンバーか */
  isMember: boolean
  /** ピンの今の状態。ピンがなければ undefined */
  pinStatus: PinStatus | undefined
  /** その旅で、もう工事中か完成しているピンの数 */
  builtCount: number
}

/**
 * 「建築する！」を受けるかを決める。
 * メンバーなら誰でも建てられる（希望を書いた人でなくてよい。幹事だけにしない）。
 * 旅ごとの上限（20 棟）は、工事中と完成を数える。失敗したものは数えず、もう一度建てられる。
 */
export function decideBuildRequest({ isMember, pinStatus, builtCount }: BuildRequestFacts): RequestBuildResult {
  if (!isMember) return 'not-member'
  if (!pinStatus) return 'not-found'
  if (!canRequestBuild(pinStatus)) return 'already-built'
  if (builtCount >= BUILD_LIMIT_PER_TRIP) return 'limit-reached'
  return 'ok'
}
