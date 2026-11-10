import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { placesApi } from '../../adapters/places-api'
import type { Pin } from '../../domain/pin'
import { shouldVerify } from './logic'
import { verifyPlaceForPin } from './usecase'

// ピンが「工事中」になったら（features/request-build が書く）、Places で実在と位置を確かめ、ピンの位置を直す。
// 模型を作る build-model とは別に動く。模型は位置も placeId も使わないので、どちらが先に終わってもよい。
// ルート（propose-routes）はピンが「完成」になってから作る。本物の模型は数分かかるので、たいていは直した位置で組まれる。
// 部品の模型（約 4 秒で完成）では、こちらが遅れて推測の位置で組まれることがある。そのときも、しおりの移動時間
// （features/shiori-travel）は開いたときのピンの位置を読み直すので、ずれるのは保存した並び順と目安だけ。
// 本番で、建てた人が合言葉を通しているか、全員に開く切り替えが入っているときだけ（usecase.ts）。Places は 1 回最大 10 秒
export const verifyPlace = onDocumentUpdated(
  { document: 'trips/{tripId}/pins/{pinId}', timeoutSeconds: 30 },
  async (event) => {
    if (!shouldVerify(event.data?.before.data() as Pin | undefined, event.data?.after.data() as Pin | undefined)) return
    const db = firestore()
    await verifyPlaceForPin({ db, aiGate: aiGate(db), placesApi }, event.params.tripId, event.params.pinId)
  },
)
