import { collection, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { colorForUid, freeColor, type Member, memberRef, newMemberData } from '@/entities/member'
import type { Session } from '@/shared/api'

/**
 * 招待 URL の旅に、表示名を入れて参加する。
 * 旅がなければ、ルールに拒否されて例外になる（招待リンクが違うとき）。
 */
export async function joinTrip(session: Session, tripId: string, displayName: string): Promise<void> {
  const me = memberRef(session.db, tripId, session.uid)
  const color = colorForUid(session.uid)
  await setDoc(me, newMemberData(session.uid, displayName, color))

  // 参加できたので、ほかの人の色が読める。重なっていたら、空いている色に変える。
  // 色が重なったままでも困らないので、ここで失敗しても参加は成功のままにする。
  try {
    const members = await getDocs(collection(session.db, 'trips', tripId, 'members'))
    const usedByOthers = members.docs
      .filter((member) => member.id !== session.uid)
      .map((member) => (member.data() as Member).color)
    const free = freeColor(color, usedByOthers)
    if (free !== color) await updateDoc(me, { color: free })
  } catch {
    // 色はそのまま
  }
}
