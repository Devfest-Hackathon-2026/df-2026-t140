import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { aiGate } from '../../adapters/aiGate'
import { firestore } from '../../adapters/firestore'
import { currentProvider, gemini, needsPermit } from '../../adapters/gemini'
import { knowledgeGraph } from '../../adapters/knowledge-graph'
import type { Pin } from '../../domain/pin'
import { shouldStartBuild } from './logic'
import { buildModelForPin } from './usecase'

/** 固定の応答（部品の模型）のときに、「工事中」を見せる時間。BUILD_STUB_DELAY_MS で変えられる */
function stubDelayMs(): number {
  const value = Number(process.env.BUILD_STUB_DELAY_MS)
  return Number.isFinite(value) && value >= 0 && process.env.BUILD_STUB_DELAY_MS ? value : 4000
}

// ピンが「工事中」になったら（features/request-build が書く）、模型を作って「完成」にする。
// 端末を閉じていても進む。本物の生成（約 2 分）に備えて、時間の上限は長めにしてある。
// Argon 1 回の待ち時間は agy でも vertex でも 255 秒まで（adapters/gemini）。やり直し 1 回を含む 2 回分が 540 秒に収まる。
// 費用のかかる経路（vertex）は、建てた人か希望を書いた人が合言葉を通していて、Argon の上限
// （1 日 20 回・累計 80 回）の中のときだけ呼ぶ（aiGate）。
// このトリガーは、自分が書いたピンの更新でもう一度呼ばれるが、「工事中で、まだ引き受けられていない」
// ときだけ進むので、繰り返さない。
export const buildModel = onDocumentUpdated(
  { document: 'trips/{tripId}/pins/{pinId}', timeoutSeconds: 540 },
  async (event) => {
    const after = event.data?.after.data() as Pin | undefined
    if (!shouldStartBuild(after)) return
    const { tripId, pinId } = event.params
    const db = firestore()
    await buildModelForPin(
      {
        db,
        gemini,
        aiGate: aiGate(db),
        knowledgeGraph,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        stubDelayMs: stubDelayMs(),
      },
      tripId,
      pinId,
      { guarded: needsPermit(currentProvider()), lookUp: currentProvider() !== 'stub' },
    )
  },
)
