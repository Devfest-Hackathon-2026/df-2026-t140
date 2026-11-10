import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { firestore } from '../../adapters/firestore'
import { voteChanged } from './logic'
import { tallyVotes as tallyVotesUsecase } from './usecase'

// メンバーの「投票したルート」が変わったら（票は、ルールで必ずこの項目とそろう）、全員が投票したかを見て、
// そろっていたら、いちばん票の多いルートに決める。メンバーが抜けて、残りの全員が投票済みになったときも決まる。
// 書くのは旅の状態だけで、メンバーには書き戻さないので、繰り返さない。Gemini は呼ばない。
export const tallyVotes = onDocumentWritten(
  { document: 'trips/{tripId}/members/{uid}', timeoutSeconds: 60 },
  async (event) => {
    if (!voteChanged(event.data?.before.data(), event.data?.after.data())) return
    await tallyVotesUsecase({ db: firestore() }, event.params.tripId)
  },
)
