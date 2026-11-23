import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { currentProvider, gemini, needsPermit } from '../../adapters/gemini'
import { odptFlights } from '../../adapters/odpt'
import { becameDone } from './logic'
import { updateRoutesForTrip } from './usecase'

// 建物が建ったら（features/build-model がピンを「完成」にする）、ルート案を作る（作り直す）。
// ルートが決まったあとなら、決まったルートにその場所を足して組み直す（投票はやり直さない）。
// ピンが「完成」になった瞬間だけ動く。書くのはルート案とメンバーの票で、ピンには書き戻さないので、繰り返さない。
// 既定は固定の応答（自分たちの計算）。手元では GEMINI_PROVIDER=agy で本物の Gemini Flash につながる（回数の上限は adapters/gemini/agy.ts）。
// 費用のかかる経路（vertex）は、旅の建った場所の持ち主の誰かが合言葉を通していて、Flash の累計が上限の中のときだけ呼ぶ（aiGate）。
// agy の Flash は 1 回最大 150 秒（adapters/gemini/agy.ts）で、形が違えば 1 回やり直す。その 2 回分（300 秒）が収まる長さにする。
// 飛行機の区間があれば、時刻表（ODPT。料金はかからない）を読んで便を決める（最大 20 秒。adapters/odpt.ts）。合わせて 320 秒に、余りを足した長さにする
export const proposeRoutes = onDocumentUpdated(
  { document: 'trips/{tripId}/pins/{pinId}', timeoutSeconds: 360 },
  async (event) => {
    if (!becameDone(event.data?.before.data(), event.data?.after.data())) return
    const db = firestore()
    await updateRoutesForTrip({ db, gemini, aiGate: aiGate(db), flights: odptFlights }, event.params.tripId, {
      guarded: needsPermit(currentProvider()),
    })
  },
)
