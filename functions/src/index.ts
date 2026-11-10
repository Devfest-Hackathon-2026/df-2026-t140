import { setGlobalOptions } from 'firebase-functions/v2'

// ここは全体の設定と、関数の一覧だけ（1 機能 1 行）。処理は features/<機能>/ に書く。
// 置き場所の決まりは docs/architecture/design-principles.md。
//   features/<機能>/handler.ts   入口。入力を確かめ、adapters の実体を usecase・logic に渡す
//   features/<機能>/usecase.ts   読む → logic で決める → 書く（Firestore はここで使う）
//   features/<機能>/logic.ts     SDK を使わない純粋な判断
//   adapters/                    外部の SDK を使う実体（Gemini の呼び出し口は adapters/gemini）
//   ports/                       差し替えるものの型
//   domain/                      このアプリの決まりとデータの型
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 2 })

export { pingGemini } from './features/ping'
export { suggestPlaces } from './features/suggest-places'
export { requestBuild } from './features/request-build'
export { buildModel } from './features/build-model'
export { proposeRoutes } from './features/propose-routes'
export { tallyVotes } from './features/tally-votes'
export { unlockAi } from './features/unlock-ai'
export { shioriTravel } from './features/shiori-travel'
export { verifyPlace } from './features/verify-place'
export { placeReviews } from './features/place-reviews'
