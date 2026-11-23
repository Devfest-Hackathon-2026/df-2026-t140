import { setGlobalOptions } from 'firebase-functions/v2'

// ここは全体の設定と、関数の一覧だけ（1 機能 1 行）。処理は features/<機能>/ に書く。
// 置き場所の決まりは docs/architecture/design-principles.md。
//   features/<機能>/handler.ts   入口。入力を確かめ、adapters の実体を usecase・logic に渡す
//   features/<機能>/usecase.ts   読む → logic で決める → 書く（Firestore はここで使う）
//   features/<機能>/logic.ts     SDK を使わない純粋な判断
//   adapters/                    外部の SDK を使う実体（Gemini の呼び出し口は adapters/gemini）
//   ports/                       差し替えるものの型
//   domain/                      このアプリの決まりとデータの型
// メモリーは 512 MiB（256 MiB では、飛行機の時刻表を読む関数が本番で落ちた。かめの決定、todo/humans/2026-11-22-functions-memory-512.md）
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 2, memory: '512MiB' })

export { pingGemini } from './features/ping'
export { suggestPlaces } from './features/suggest-places'
export { requestBuild } from './features/request-build'
export { buildModel } from './features/build-model'
export { proposeRoutes } from './features/propose-routes'
export { tallyVotes } from './features/tally-votes'
export { unlockAi } from './features/unlock-ai'
export { shioriTravel } from './features/shiori-travel'
export { shioriWeather } from './features/shiori-weather'
// 旅程の確定と取り消し（発案者だけ）
export { confirmShiori } from './features/confirm-shiori'
export { reorderShiori } from './features/reorder-shiori'
export { removeBuilding } from './features/remove-building'
export { restorePlace } from './features/restore-place'
export { verifyPlace } from './features/verify-place'
export { placeReviews } from './features/place-reviews'
export { countMapLoad, getApiUsage } from './features/api-usage'
export { findTripByJoinCode, issueJoinCode, prepareJoinCode } from './features/join-code'
export { previewTrip } from './features/trip-preview'
export { moveMemberships } from './features/move-memberships'
export { resolveOrigin, changeOrigin } from './features/resolve-origin'
export { suggestTripTitle } from './features/suggest-title'
export { changeTravelMode } from './features/change-travel-mode'
export { changeTripDates } from './features/change-trip-dates'
export { changeLegMode } from './features/change-leg-mode'
export { setStopTime } from './features/set-stop-time'
export { setLodging } from './features/set-lodging'
export { setMeal } from './features/set-meal'
export { refillAfterConfirm, refillAfterDismiss, suggestFillers } from './features/suggest-fillers'
export { dismissFiller } from './features/dismiss-filler'
export { repeatVisit } from './features/repeat-visit'
