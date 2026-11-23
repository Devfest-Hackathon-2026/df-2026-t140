import { FieldValue } from 'firebase-admin/firestore'
import {
  isJoinCode,
  JOIN_CODE_ATTEMPTS_COLLECTION,
  JOIN_CODES_COLLECTION,
  newJoinCode,
  normalizeJoinCode,
} from '../../domain/joinCode'
import { isLockedOut, JOIN_CODE_ISSUE_TRIES, readAttempts, recordFailure } from './logic'
import type { JoinCodePorts } from './ports'
import type { FindTripResult, IssueJoinCodeResult } from './types'

/**
 * その旅の合言葉を返す。まだなければ作る。頼めるのは旅のメンバーだけ。
 * 合言葉は旅に 1 つで、作ったあとは変わらない（2 人が同時に頼んでも、同じ合言葉が返る）。
 * ふつうは旅ができたときに prepareJoinCode が作っておくので、ここは前からある旅と、作るのが遅れたときのため
 */
export async function issueJoinCode(
  ports: JoinCodePorts,
  input: { tripId: string; uid: string },
): Promise<IssueJoinCodeResult> {
  return ensureJoinCode(ports, input.tripId, input.uid)
}

/**
 * 旅ができたときに、合言葉を裏で作っておく（招待のシートを開いた時点で出ているように。Lazyturtle0852 の決定、2026-11-22）。
 * Functions のトリガーから呼ぶので、メンバーかは確かめない。旅がなければ（もう消えた）何もしない
 */
export async function prepareJoinCode(ports: JoinCodePorts, tripId: string): Promise<IssueJoinCodeResult> {
  return ensureJoinCode(ports, tripId, null)
}

/**
 * 旅の合言葉を返す。まだなければ作る。uid があれば、その人が旅のメンバーかも確かめる。
 * 空いているかの確認と書き込みを 1 つのトランザクションにして、2 つの旅に同じ合言葉が付かないようにする
 */
async function ensureJoinCode(ports: JoinCodePorts, tripId: string, uid: string | null): Promise<IssueJoinCodeResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(tripId)
  return db.runTransaction(async (tx) => {
    const [trip, member] = await Promise.all([
      tx.get(tripRef),
      uid === null ? Promise.resolve(null) : tx.get(tripRef.collection('members').doc(uid)),
    ])
    if (!trip.exists || (member !== null && !member.exists)) return 'not-member'
    const existing: unknown = trip.data()?.joinCode
    if (isJoinCode(existing)) return { status: 'ok', joinCode: existing }

    for (let attempt = 0; attempt < JOIN_CODE_ISSUE_TRIES; attempt += 1) {
      const joinCode = newJoinCode(ports.random)
      const codeRef = db.collection(JOIN_CODES_COLLECTION).doc(joinCode)
      if ((await tx.get(codeRef)).exists) continue
      tx.set(codeRef, { tripId, createdAt: FieldValue.serverTimestamp() })
      tx.update(tripRef, { joinCode })
      return { status: 'ok', joinCode }
    }
    return 'busy'
  })
}

/**
 * 旅の合言葉から旅の ID を引く。参加はさせない（画面が旅の参加の画面を開き、本人が名前を入れて参加する）。
 * 間違えた回数は joinCodeAttempts/{uid} に数え、何度も間違えたらしばらく断る（logic の JOIN_CODE_FAILURE_MAX）。
 * 同時に何度も送っても回数が飛ばないよう、読むのと書くのを 1 つのトランザクションにする
 */
export async function findTripByJoinCode(
  ports: Pick<JoinCodePorts, 'db'>,
  input: { uid: string; joinCode: unknown; now: number },
): Promise<FindTripResult> {
  const { db } = ports
  const attemptsRef = db.collection(JOIN_CODE_ATTEMPTS_COLLECTION).doc(input.uid)
  const joinCode = normalizeJoinCode(input.joinCode)
  return db.runTransaction(async (tx) => {
    const attempts = readAttempts((await tx.get(attemptsRef)).data())
    if (isLockedOut(attempts, input.now)) return 'locked'
    // 形が違うものは、どの旅にも当たらない。数えない（打ちかけで送っても回数を減らさない）
    if (!joinCode) return 'invalid'

    const tripId: unknown = (await tx.get(db.collection(JOIN_CODES_COLLECTION).doc(joinCode))).data()?.tripId
    if (typeof tripId !== 'string') {
      tx.set(attemptsRef, recordFailure(attempts, input.now))
      return 'not-found'
    }
    return { status: 'ok', tripId }
  })
}
