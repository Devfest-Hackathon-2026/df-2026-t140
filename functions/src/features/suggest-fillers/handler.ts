import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { firestore } from '../../adapters/firestore'
import { refreshFillers } from './usecase'

// しおりの空いた時間への提案（#520）。しおりが変わるたびに、空きが 2 時間以上ある日へ、見本の場所の一覧から近くの場所を 1 つ立てる。
// Gemini も Maps も呼ばない（費用なし）。書くのはピンだけなので、ルートの組み直しは動かず、繰り返さない。
// 書いている途中で提案が建てられたら（読んだときから変わった）、書くのをやめる。次にしおりが変わったときにやり直す
export const suggestFillers = onDocumentWritten('trips/{tripId}/routes/{routeId}', async (event) => {
  try {
    await refreshFillers({ db: firestore() }, event.params.tripId)
  } catch (cause) {
    console.error(`旅 ${event.params.tripId} の空いた時間への提案を立て直せませんでした`, cause)
  }
})

// 旅程を確定・取り消ししたら（features/confirm-shiori。trips の文書だけを書く）、提案を消す・立て直す（確定中は提案しない）
export const refillAfterConfirm = onDocumentUpdated('trips/{tripId}', async (event) => {
  const before = Boolean(event.data?.before.data()?.confirmed)
  const after = Boolean(event.data?.after.data()?.confirmed)
  if (before === after) return
  try {
    await refreshFillers({ db: firestore() }, event.params.tripId)
  } catch (cause) {
    console.error(`旅 ${event.params.tripId} の空いた時間への提案を立て直せませんでした`, cause)
  }
})

// 提案を「無視」したら（features/dismiss-filler）、その日に次の提案を立てる
export const refillAfterDismiss = onDocumentUpdated('trips/{tripId}/pins/{pinId}', async (event) => {
  const before = event.data?.before.data()
  const after = event.data?.after.data()
  if (!after?.filler?.dismissed || before?.filler?.dismissed) return
  try {
    await refreshFillers({ db: firestore() }, event.params.tripId)
  } catch (cause) {
    console.error(`旅 ${event.params.tripId} の空いた時間への提案を立て直せませんでした`, cause)
  }
})
