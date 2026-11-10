import { type App, initializeApp } from 'firebase-admin/app'
import { type Firestore, getFirestore } from 'firebase-admin/firestore'

let app: App | undefined

/**
 * Firestore（Admin SDK。Security Rules を通らない）。各機能の handler が usecase に渡す。
 * 読み込み時ではなく、最初に使うときにつなぐ（コールドスタートを軽くするため）。
 * getApps() では確かめない（firebase-functions が中で別の名前のアプリを作っていて、既定のアプリがなくても空にならない）。
 */
export function firestore(): Firestore {
  app ??= initializeApp()
  return getFirestore(app)
}
