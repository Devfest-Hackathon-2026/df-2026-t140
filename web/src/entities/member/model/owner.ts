import type { WithId } from '@/shared/api'
import type { Member } from './types'

/**
 * 発案者（旅を作った人。これまでの幹事にあたる）の uid。今いるメンバーのうち、いちばん早く入った人。
 * 旅を作った人が抜けたら、次に入った人が発案者になる（かめの決定、2026-11-21）。メンバーがいなければ null。
 * 同じ時刻なら uid の小さい方。入った時刻がまだない（書き込みの途中）メンバーは、いちばん後ろに数える。
 * Functions 側の同じ決まりは functions/src/domain/tripOwner.ts。片方を変えたら、もう片方も合わせる
 */
export function ownerUidOf(members: readonly WithId<Member>[] | null | undefined): string | null {
  let owner: { uid: string; at: number } | null = null
  for (const member of members ?? []) {
    const at = typeof member.joinedAt?.toMillis === 'function' ? member.joinedAt.toMillis() : Number.POSITIVE_INFINITY
    if (!owner || at < owner.at || (at === owner.at && member.id < owner.uid)) owner = { uid: member.id, at }
  }
  return owner?.uid ?? null
}
