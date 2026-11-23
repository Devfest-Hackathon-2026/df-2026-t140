// 希望がまだ探している途中かの判断。外の import は型だけにして、scripts/web.test.mjs から読めるようにする
import type { Wish } from '@/entities/wish'

/**
 * さがし中と見なす時間。本物の Gemini（agy）は 1 回 20〜40 秒が普通だが、長いと 1 回 150 秒まで待ち、
 * 形が違えば 1 回やり直す。その 2 回分（300 秒）と、関数の打ち切り時間（functions の suggest-places、330 秒）に合わせる
 */
export const SEARCH_TIMEOUT_MS = 330_000

/**
 * 希望がまだ探している途中か。書いてから SEARCH_TIMEOUT_MS たったものは、関数が途中で止まったとみなす
 * （時間切れでは「失敗」が書かれないので、いつまでも「さがし中」にしない。宿さがし・お店さがしのボタンもこれで戻す。#729）
 */
export function isWishSearching(wish: Pick<Wish, 'status' | 'createdAt'>, now: Date): boolean {
  if (wish.status !== 'pending' && wish.status !== 'searching') return false
  // 書いた直後は、サーバーの時刻がまだ入っていない（null）ことがある。そのときは探している途中とみなす
  const at = wish.createdAt?.toDate?.()
  return !at || now.getTime() - at.getTime() < SEARCH_TIMEOUT_MS
}
