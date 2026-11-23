// 発案者（旅を作った人。これまでの幹事にあたる）を、旅の今のメンバーから決める。
// 発案者は、今いるメンバーのうち、いちばん早く入った人。旅を作った人が抜けたら、次に入った人が発案者になる
// （かめの決定、2026-11-21。企画書「ユーザー体験」の発案者）。データに持たず、メンバーから毎回決めるので、抜けたときに書き換える処理は要らない。
// 画面側の同じ決まりは web/src/entities/member/model/owner.ts。片方を変えたら、もう片方も合わせる

export interface MemberJoin {
  uid: string
  /** 入った時刻（ミリ秒）。まだ書き込みが終わっていない（時刻がない）メンバーは、いちばん後ろに数える */
  joinedAtMillis: number | null
}

/** 発案者の uid。メンバーがいなければ null。同じ時刻なら uid の小さい方 */
export function ownerUid(members: MemberJoin[]): string | null {
  let owner: MemberJoin | null = null
  for (const member of members) {
    if (!owner || earlier(member, owner)) owner = member
  }
  return owner?.uid ?? null
}

function earlier(a: MemberJoin, b: MemberJoin): boolean {
  const left = a.joinedAtMillis ?? Number.POSITIVE_INFINITY
  const right = b.joinedAtMillis ?? Number.POSITIVE_INFINITY
  return left !== right ? left < right : a.uid < b.uid
}

/** Firestore のメンバーの文書から、入った時刻を読む（Timestamp でなければ null） */
export function memberJoin(uid: string, data: { joinedAt?: unknown } | undefined): MemberJoin {
  const joinedAt = data?.joinedAt as { toMillis?: () => number } | null | undefined
  return { uid, joinedAtMillis: typeof joinedAt?.toMillis === 'function' ? joinedAt.toMillis() : null }
}
