import { randomInt } from 'node:crypto'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import type { FindTripResult, IssueJoinCodeResult } from './types'
import { findTripByJoinCode as findTripUsecase, issueJoinCode as issueJoinCodeUsecase, prepareJoinCode as prepareUsecase } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/** 断った理由を、画面に出せる形（コードと文）にする */
const ISSUE_REFUSALS: Record<Extract<IssueJoinCodeResult, string>, HttpsError> = {
  'not-member': new HttpsError('permission-denied', 'この旅のメンバーではありません'),
  busy: new HttpsError('unavailable', '旅の合言葉を作れませんでした。もう一度試してください'),
}

const FIND_REFUSALS: Record<Extract<FindTripResult, string>, HttpsError> = {
  invalid: new HttpsError('invalid-argument', '旅の合言葉は、英数字 6 文字です'),
  'not-found': new HttpsError('not-found', 'この合言葉の旅が見つかりません'),
  locked: new HttpsError('resource-exhausted', '合言葉を何度も間違えたので、しばらく使えません'),
}

// 旅ができたら、合言葉を裏で作っておく（招待のシートを開いた時点で出ているように）。
// 作れなかったとき（合言葉が続けてぶつかった）は、シートを開いたときに issueJoinCode が作り直す
export const prepareJoinCode = onDocumentCreated('trips/{tripId}', async (event) => {
  const result = await prepareUsecase({ db: firestore(), random: randomInt }, event.params.tripId)
  if (result === 'busy') console.warn('旅の合言葉を先に作れませんでした', event.params.tripId)
})

// 旅の合言葉を返す（なければ作る）。招待の画面が、旅に合言葉がまだないときに呼ぶ。
// 旅のメンバーだけが呼べる。Gemini も Maps も呼ばない。
export const issueJoinCode = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId } = (request.data ?? {}) as { tripId?: unknown }
  if (typeof tripId !== 'string' || !ID.test(tripId)) throw new HttpsError('invalid-argument', '旅を指定してください')

  const result = await issueJoinCodeUsecase(
    { db: firestore(), random: randomInt },
    { tripId, uid: request.auth.uid },
  )
  if (typeof result === 'string') throw ISSUE_REFUSALS[result]
  return { joinCode: result.joinCode }
})

// 旅の合言葉から、旅の ID を引く。ホームの「旅の合言葉で参加する」が呼ぶ。
// 端末から合言葉の一覧を読めないようにして、ここで間違えた回数を数える（総当たりを防ぐ）。
// 参加はさせない。画面が旅の参加の画面を開く（招待リンクを開いたときと同じ）。
export const findTripByJoinCode = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { joinCode } = (request.data ?? {}) as { joinCode?: unknown }

  const result = await findTripUsecase({ db: firestore() }, { uid: request.auth.uid, joinCode, now: Date.now() })
  if (typeof result === 'string') throw FIND_REFUSALS[result]
  return { tripId: result.tripId }
})
