import { translate as t } from '../../../shared/lib/language.ts'
// 連携できなかった理由を、画面に出す文にする。SDK を import しない（確認テストから読めるように）。

/** code は Firebase のエラーのコード（auth/…）。分からないとき（null など）は、決まった文にする */
export function linkProblem(code: unknown): string {
  if (code === 'auth/operation-not-allowed') return t('Google アカウントとの連携はまだ使えません。', 'Google account connection is currently unavailable.')
  if (code === 'auth/popup-blocked') {
    return t('ログインの画面を開けませんでした。ブラウザの設定でポップアップを許可して、もう一度押してください。', 'Could not open the sign-in window. Allow pop-ups in your browser and try again.')
  }
  return t('連携できませんでした。電波のよいところで、もう一度押してください。', 'Could not connect your Google account. Check your connection and try again.')
}

/** 投げられたものから、エラーのコードを取り出す。コードがなければ（null、文字列など）null */
export function errorCode(cause: unknown): string | null {
  const code = (cause as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : null
}
