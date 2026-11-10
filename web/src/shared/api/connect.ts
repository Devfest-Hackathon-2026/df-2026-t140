import { type FirebaseApp, type FirebaseOptions, initializeApp } from 'firebase/app'
import { type Auth, connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import { connectFirestoreEmulator, type Firestore, getFirestore, terminate } from 'firebase/firestore'
import { connectFunctionsEmulator, type Functions, getFunctions } from 'firebase/functions'
import { simFrame } from '../lib/simFrame'

const REGION = 'asia-northeast1'

// ローカルと本番で同じビルド成果物を動かすため、ビルド時ではなく開いた場所で判定する。
// 手元の Mac、同じ Wi-Fi のアドレス（192.168.*、10.*、172.16〜31.*）、
// Tailscale のアドレス（100.64.0.0/10 = 100.64〜100.127.*。Wi-Fi が違うスマホから開くとき）をローカルとみなす。
const LOCAL_HOST =
  /^(localhost$|127\.0\.0\.1$|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

/** Emulator につないでいるか。開発用の画面（複数人シミュレーションなど）を出す判定に使う */
export const isLocal = LOCAL_HOST.test(location.hostname)

/**
 * 匿名ログイン済みの接続。データを読み書きする処理は、必ずこれを引数で受け取る
 * （画面ごとに別の人として動かせるようにするため。複数人シミュレーションで使う）。
 */
export interface Session {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
  /** 匿名ログインした人。端末（ブラウザ）ごと、アプリ名ごとに別の人になる */
  uid: string
}

// 設定はローカルでも本番でも Hosting から読む。公開リポジトリに API キーを置かないため。
let config: Promise<FirebaseOptions> | undefined
function loadConfig(): Promise<FirebaseOptions> {
  config ??= fetch('/__/firebase/init.json').then((response) => {
    if (!response.ok) throw new Error(`Firebase の設定を読めませんでした（${response.status}）`)
    return response.json()
  })
  return config
}

async function open(appName?: string): Promise<Session> {
  const app = initializeApp(await loadConfig(), appName)
  const auth = getAuth(app)
  const db = getFirestore(app)
  const functions = getFunctions(app, REGION)

  if (isLocal) {
    // 複数人シミュレーションの中の画面は、Emulator のホスト名を画面ごとに変える（sim-a.localhost など。
    // ブラウザは *.localhost を自分自身にする）。Emulator は HTTP/1.1 で、ブラウザは同じホストに 6 本までしか
    // つながないので、3 つの画面が同じホスト名で Firestore を購読すると、書き込みが待たされて進まなくなる
    const host = simFrame ? `${simFrame.appName}.localhost` : location.hostname
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
    connectFirestoreEmulator(db, host, 8080)
    connectFunctionsEmulator(functions, host, 5001)
  }

  // ページを離れるときに、Firestore の接続を閉じる。ブラウザは「戻る」に備えて前のページを
  // 凍らせて残すことがあり（bfcache）、そのページの接続が残ると、Emulator（HTTP/1.1。同じ相手に
  // 6 本まで）では次のページの書き込みが 20 秒以上待たされる。本番は HTTP/2 なので待たされないが、
  // 凍ったページは同期が止まっているので、どちらでも閉じて、戻ってきたら読み込み直す。
  let closed = false
  addEventListener('pagehide', () => {
    closed = true
    void terminate(db)
  })
  const reloadIfClosed = () => {
    if (closed) location.reload()
  }
  addEventListener('pageshow', reloadIfClosed)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reloadIfClosed()
  })

  // 前に開いたときのログインが残っていれば、同じ人として続ける
  await auth.authStateReady()
  const user = auth.currentUser ?? (await signInAnonymously(auth)).user

  return { app, auth, db, functions, uid: user.uid }
}

const sessions = new Map<string, Promise<Session>>()

/**
 * Firebase につなぎ、匿名ログインする。同じ appName なら同じ接続を返す
 * （開発時の React StrictMode でも 1 回だけログインする）。
 * appName を変えると、同じブラウザの中でも別の匿名ユーザーになる。
 */
export function connect(appName = '[DEFAULT]'): Promise<Session> {
  let session = sessions.get(appName)
  if (!session) {
    session = open(appName === '[DEFAULT]' ? undefined : appName)
    sessions.set(appName, session)
  }
  return session
}
