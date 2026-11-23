import { type App, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

let app: App | undefined

/**
 * ID トークンが、匿名ログインの人の本物のトークンなら、その人の uid を返す。違えば null。
 * 手元では Auth Emulator のトークンを確かめる（Functions の Emulator が接続先を環境変数で渡す）。
 * adapters/firestore.ts とは別の名前のアプリにして、どちらが先に呼ばれても動くようにする
 */
export async function anonymousUidOf(idToken: string): Promise<string | null> {
  app ??= initializeApp(undefined, 'auth')
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken)
    return decoded.firebase.sign_in_provider === 'anonymous' ? decoded.uid : null
  } catch {
    return null
  }
}
