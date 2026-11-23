// 旅程の確定と取り消しを受けるかの純粋な判断（scripts/functions.test.mjs で確かめる）。

export interface ConfirmFacts {
  isMember: boolean
  /** 頼んだ人が発案者か（domain/tripOwner.ts） */
  isOwner: boolean
  /** 旅があるか */
  tripExists: boolean
  /** 確定するなら true、取り消すなら false */
  confirm: boolean
  /** 建った（完成した）場所の数 */
  doneCount: number
  /** 作っている途中（工事中）の場所の数 */
  buildingCount: number
  /**
   * 建った（完成した）のに、まだしおりに入っていない場所の数。完成すると、別のトリガー（propose-routes）が少し遅れてしおりに足す。
   * その間に確定すると、確定中は足さないので、その場所がしおりから抜けたままになる。なので、そろうまでは確定しない
   */
  unlistedCount?: number
  /**
   * 宿がまだ決まっていない夜の数（宿の建物も、宿を取らないことも決めていない夜。domain/route.ts の openLodgingNights）。
   * 残っていると確定しない（企画書「ユーザー体験」3-7）
   */
  openLodgingCount?: number
}

export type ConfirmDecision = 'confirm' | 'unconfirm' | 'not-member' | 'not-found' | 'not-owner' | 'empty' | 'building' | 'lodging'

/**
 * 確定・取り消しを受けるかを決める。どちらも発案者だけ。
 * 確定は、しおりに建った場所があり、作っている途中の建物がなく、建った場所がすべてしおりに入っているときだけ（確定すると建物もしおりも止まるので、途中のものを残さない）。
 * 泊まりの旅で、宿がまだ決まっていない夜が残っているときは 'lodging'（宿を建てるか、宿を取らないと決めてから確定する）。
 * もう確定している旅をもう一度確定する、確定していない旅を取り消す、は書かずにそのまま受ける（usecase が見る）
 */
export function decideConfirm(facts: ConfirmFacts): ConfirmDecision {
  if (!facts.isMember) return 'not-member'
  if (!facts.tripExists) return 'not-found'
  if (!facts.isOwner) return 'not-owner'
  if (!facts.confirm) return 'unconfirm'
  if (facts.buildingCount > 0 || (facts.unlistedCount ?? 0) > 0) return 'building'
  if (facts.doneCount === 0) return 'empty'
  if ((facts.openLodgingCount ?? 0) > 0) return 'lodging'
  return 'confirm'
}
