import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { aiGate } from '../../adapters/aiGate'
import { countApiCall } from '../../adapters/apiUsage'
import { firestore } from '../../adapters/firestore'
import { placesPhotosEnabled } from '../../adapters/places-api'
import { canCountMapLoad } from './logic'
import { getApiUsage as getApiUsageUsecase } from './usecase'

// API の使用量（デバッグ用。PC の幅のとき、画面の外側に出す。web/src/widgets/usage-panel）。
// 本番では合言葉を通した人だけ。手元（Emulator）では誰でも。読むだけで、外の API は呼ばない
export const getApiUsage = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const db = firestore()
  const result = await getApiUsageUsecase(
    { db, aiGate: aiGate(db) },
    {
      uid: request.auth.uid,
      local: process.env.FUNCTIONS_EMULATOR === 'true',
      // 写真は手元では見本を返して Places を呼ばないので、本番の設定だけを見る
      photosEnabled: placesPhotosEnabled(),
      now: new Date(),
    },
  )
  if (result.status === 'locked') throw new HttpsError('permission-denied', '合言葉を通した人だけが見られます')
  return result
})

// 地図を 1 つ作ったと数える（地図の読み込みは画面から直接 Google に頼むので、Functions では見えない）。
// 画面が地図を作るたびに 1 回呼ぶ（web/src/widgets/trip-map の GoogleSurface）。表示のための数で、止めるのは Google Cloud の割り当て。
// 本番では合言葉を通した人の分だけ数える（logic の canCountMapLoad）。通していない人には断らず、数えずに返す
export const countMapLoad = onCall({ timeoutSeconds: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const local = process.env.FUNCTIONS_EMULATOR === 'true'
  const unlocked = local || (await aiGate(firestore()).isUnlocked(request.auth.uid))
  if (!canCountMapLoad({ local, unlocked })) return { status: 'skipped' as const }
  await countApiCall('mapsLoad')
  return { status: 'counted' as const }
})
