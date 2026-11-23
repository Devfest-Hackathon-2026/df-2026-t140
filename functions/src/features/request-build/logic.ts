import { BUILD_LIMIT_PER_TRIP, canRequestBuild, type Pin, type PinStatus } from '../../domain/pin'
import type { RequestBuildResult } from './types'

// 建築の依頼を受けるかどうかの純粋な判断（scripts/functions.test.mjs で確かめる）。

export interface BuildRequestFacts {
  /** 頼んだ人が旅のメンバーか */
  isMember: boolean
  /** 旅程が確定しているか */
  confirmed?: boolean
  /** ピンの今の状態。ピンがなければ undefined */
  pinStatus: PinStatus | undefined
  /** その旅で、もう工事中か完成しているピンの数 */
  builtCount: number
  /** しおりの空いた時間への提案で、「無視」を押したものか（#520。無視した提案は建てない） */
  dismissed?: boolean
  /** 工事中のまま止まったピンか（domain/pin.ts の isStaleBuild。#727）。失敗したものと同じく、もう一度建てられる */
  stale?: boolean
}

/**
 * 「建築する！」を受けるかを決める。
 * メンバーなら誰でも建てられる（希望を書いた人でなくてよい。幹事だけにしない）。
 * 旅程が確定しているあいだは、誰も建てられない（features/confirm-shiori）。
 * 旅ごとの上限（20 棟）は、工事中と完成を数える。失敗したものは数えず、もう一度建てられる。
 * 工事中のまま止まったピン（stale）は失敗したものと同じに扱う。builtCount には自分も入っているので、1 つ引いて比べる
 */
export function decideBuildRequest({ isMember, confirmed = false, pinStatus, builtCount, dismissed = false, stale = false }: BuildRequestFacts): RequestBuildResult {
  if (!isMember) return 'not-member'
  if (confirmed) return 'confirmed'
  if (!pinStatus || dismissed) return 'not-found'
  const retryStale = stale && pinStatus === 'building'
  if (!retryStale && !canRequestBuild(pinStatus)) return 'already-built'
  if ((retryStale ? builtCount - 1 : builtCount) >= BUILD_LIMIT_PER_TRIP) return 'limit-reached'
  return 'ok'
}

/**
 * 建築を受けたときにピンに書く項目（時刻は除く）。しおりの空いた時間への提案（filler）は誰の希望でもないので、
 * 「入れる」を押した人のやりたいことにする（#520）
 */
export function buildUpdate(pin: Pick<Pin, 'filler'>, uid: string): { status: 'building'; builtBy: string; buildStartedAt: null; uid?: string } {
  return { status: 'building', builtBy: uid, buildStartedAt: null, ...(pin.filler ? { uid } : {}) }
}
