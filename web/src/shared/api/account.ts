import {
  type Auth,
  type AuthError,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  onIdTokenChanged,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  signInWithCredential,
  signOut,
  type User,
} from 'firebase/auth'
import { type Functions, httpsCallable } from 'firebase/functions'
import { encodeLinkOutcome, type LinkOutcome, parseLinkOutcome } from './linkOutcome'
import { markSwitching } from './switching'

// Google アカウントとの連携（任意）。連携しなくても、匿名ログインのまま使える。
//   はじめての連携：匿名の自分に Google アカウントをつなぐ。uid は変わらず、参加している旅もそのまま
//   連携済みの Google アカウントで、ほかの端末からログイン：その Google アカウントの自分に切り替わる（uid が変わる）。
//     その端末で匿名のまま参加していた旅は、Functions（features/move-memberships）が今の自分へ引き継ぐ
// uid が変わったら、呼ぶ側がページを読み込み直す（接続は uid を持っているので、作り直す）。

/** 今ログインしている人。google が false なら匿名（この端末のこのブラウザだけの人） */
export interface Account {
  google: boolean
  /** 連携している Google アカウントのメールアドレス。本人の画面にだけ出す */
  email: string | null
}

/**
 * linked：匿名の自分に Google アカウントをつないだ（uid はそのまま）。
 * switched：連携済みの Google アカウントの自分に切り替わった（uid が変わった。読み込み直す）。
 * cancelled：本人がログインの画面を閉じた。
 * redirecting：ログインの画面へ移る（戻ってきたら、つないだ直後に finishGoogleRedirect が続きを行う）。
 */
export type GoogleLinkOutcome = 'linked' | 'switched' | 'cancelled' | 'redirecting'

const REDIRECT_PENDING = 'googleRedirectPending'
const LINK_OUTCOME = 'googleLinkOutcome'
const PENDING_MOVE = 'googlePendingMove'
/** カレンダーの許可をもらうために、ログインの画面へ移った（link：連携から、reauth：連携済みの人の確かめ直し） */
const CALENDAR_REDIRECT = 'googleCalendarRedirect'
/** 読み込み直しをまたいで、カレンダーのアクセストークンを渡す。読んだら消す */
const CALENDAR_TOKEN = 'googleCalendarToken'
/** Google カレンダーの予定を読み書きする許可（Calendar API の events） */
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

// ログインの画面との行き来をまたいで覚える小さな値。タブを閉じたら消える。使えない環境では覚えないだけ
function keep(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // 覚えられなくても、連携そのものはできる
  }
}

function take(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    return value
  } catch {
    return null
  }
}

export function accountOf(user: User | null): Account {
  const google = user?.providerData.find((provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID)
  return { google: Boolean(google), email: google?.email ?? null }
}

/** ログインしている人が変わるたび（連携した、など）に届ける */
export function subscribeAccount(auth: Auth, onData: (account: Account) => void): () => void {
  return onIdTokenChanged(auth, (user) => onData(accountOf(user)))
}

/**
 * ホーム画面に置いたアプリ（PWA）の中か。その中では別ウィンドウのログイン画面と行き来できないので、
 * 画面ごとログインの画面へ移る。手元では URL に ?redirect を付けると、ブラウザでも同じ動きを確かめられる
 */
function usesRedirect(local: boolean): boolean {
  if (local && new URLSearchParams(location.search).has('redirect')) return true
  const standalone = (navigator as { standalone?: boolean }).standalone === true
  return standalone || matchMedia('(display-mode: standalone)').matches
}

/**
 * 連携できなかった理由から、続きを決める。
 * 「その Google アカウントは、もうほかの自分につないである」なら、その自分に切り替えて、今の端末の旅を引き継ぐ。
 * reloads：切り替えたあと、呼ぶ側がページを読み込み直すか。読み込み直すなら、切り替えるあいだ画面を隠す
 * （ログインの画面から戻ったところ＝つなぐ途中で切り替えるときは、まだ画面がなく、読み込み直しもしないので隠さない）
 */
async function settle(
  auth: Auth,
  functions: Functions,
  user: User,
  cause: unknown,
  reloads: boolean,
): Promise<GoogleLinkOutcome> {
  const error = cause as AuthError
  if (
    error.code === 'auth/popup-closed-by-user' ||
    error.code === 'auth/cancelled-popup-request' ||
    error.code === 'auth/user-cancelled'
  ) {
    return 'cancelled'
  }
  if (error.code !== 'auth/credential-already-in-use') throw cause
  const credential = GoogleAuthProvider.credentialFromError(error)
  if (!credential) throw cause

  // 切り替える前に、今の自分（匿名）の本人である証拠を取っておく。切り替えたあとは取れない
  const fromIdToken = user.isAnonymous ? await user.getIdToken() : null
  // 人が変わる前に画面を隠す（読み込み直すまで、前の人の購読がエラーを出すため）
  if (reloads) markSwitching(auth, true)
  try {
    await signInWithCredential(auth, credential)
  } catch (failure) {
    markSwitching(auth, false)
    throw failure
  }
  if (fromIdToken) {
    keep(PENDING_MOVE, fromIdToken)
    await movePending(functions)
  }
  return 'switched'
}

/**
 * 設計方針の「shared は、このアプリの言葉（旅）を知らない道具」から外れる（design-principles.md。当たる ID はない）。
 * 理由：引き継ぎは、つないだ直後（接続を画面に渡す前）に終える必要がある。接続は uid を持っていて、
 *   人が切り替わったあとの最初の読み込みの前に、前の自分の旅が今の自分のものになっていないと、一覧に出ない
 * 代替案：引き継ぎの呼び出しを上の層（app）から connect に渡す → 複数人シミュレーションを含む
 *   すべての接続の入口に同じ引数を通すことになり、渡し忘れると黙って引き継がれない
 * 解消条件：ログインのしかたが増えて、接続の前後に処理を差し込む口を作るとき
 *
 * 切り替える前の自分の旅を、今の自分へ引き継ぐ。電波が切れたときは証拠を残し、次につないだときにやり直す。
 * 証拠が古くなって断られたら、あきらめる（招待リンクか旅の合言葉から、もう一度入れる）
 */
async function movePending(functions: Functions): Promise<void> {
  const fromIdToken = take(PENDING_MOVE)
  if (!fromIdToken) return
  try {
    await httpsCallable(functions, 'moveMemberships')({ fromIdToken })
  } catch (cause) {
    const code = (cause as { code?: string }).code
    const refused =
      code === 'functions/permission-denied' ||
      code === 'functions/invalid-argument' ||
      code === 'functions/failed-precondition'
    if (!refused) keep(PENDING_MOVE, fromIdToken)
    console.error(cause)
  }
}

/** Google アカウントと連携する（連携済みのアカウントなら、その自分に切り替える） */
export async function linkGoogle(auth: Auth, functions: Functions, local: boolean): Promise<GoogleLinkOutcome> {
  const user = auth.currentUser
  if (!user) throw new Error('ログインしていません')
  const provider = new GoogleAuthProvider()
  // 前に使ったアカウントで勝手に進めず、どのアカウントにするかを毎回選べるようにする
  provider.setCustomParameters({ prompt: 'select_account' })

  if (usesRedirect(local)) {
    keep(REDIRECT_PENDING, '1')
    await linkWithRedirect(user, provider)
    return 'redirecting'
  }
  try {
    await linkWithPopup(user, provider)
    return 'linked'
  } catch (cause) {
    return settle(auth, functions, user, cause, true)
  }
}

/**
 * ready：カレンダーの許可つきのアクセストークンをもらえた。
 * switched：連携済みの Google アカウントの自分に切り替わった（読み込み直す。トークンは takeGoogleCalendarToken で受け取る）。
 * cancelled：本人がログインの画面を閉じた。
 * redirecting：ログインの画面へ移る（戻ってきたら、takeGoogleCalendarToken で受け取る）。
 */
export type GoogleCalendarAccess = { kind: 'ready'; token: string } | { kind: 'switched' } | { kind: 'cancelled' } | { kind: 'redirecting' }

// もらったアクセストークン。保存はせず、このページを開いているあいだだけ持つ（Google のトークンは 1 時間で切れる）
let calendarToken: { token: string; expiresAt: number } | null = null

function holdCalendarToken(token: string): string {
  calendarToken = { token, expiresAt: Date.now() + 50 * 60_000 }
  return token
}

/** 読み込み直しをまたいで渡すトークン。タブの中だけに置き、受け取ったらすぐ消す */
function passCalendarToken(token: string | undefined | null): void {
  if (token) keep(CALENDAR_TOKEN, token)
}

/**
 * Google カレンダーに予定を入れるための、アクセストークンをもらう（Google のポップアップでカレンダーの許可をもらう）。
 * 連携していない人は、このポップアップで Google アカウントと連携する（連携済みのアカウントなら、その自分に切り替わる）。
 * 連携済みの人は、同じアカウントで確かめ直して許可をもらう。このページで一度もらっていれば、ポップアップは出さない
 */
export async function requestGoogleCalendarAccess(auth: Auth, functions: Functions, local: boolean): Promise<GoogleCalendarAccess> {
  if (calendarToken && calendarToken.expiresAt > Date.now()) return { kind: 'ready', token: calendarToken.token }
  const user = auth.currentUser
  if (!user) throw new Error('ログインしていません')
  const account = accountOf(user)
  const provider = new GoogleAuthProvider()
  provider.addScope(CALENDAR_SCOPE)
  // 連携済みの人は、つないであるアカウントを選ぶよう案内する（違うアカウントを選ぶと、確かめ直しが断られる）
  provider.setCustomParameters(account.google && account.email ? { login_hint: account.email } : { prompt: 'select_account' })

  if (usesRedirect(local)) {
    keep(REDIRECT_PENDING, '1')
    keep(CALENDAR_REDIRECT, account.google ? 'reauth' : 'link')
    if (account.google) await reauthenticateWithRedirect(user, provider)
    else await linkWithRedirect(user, provider)
    return { kind: 'redirecting' }
  }
  try {
    const result = account.google ? await reauthenticateWithPopup(user, provider) : await linkWithPopup(user, provider)
    // 手元の Emulator の Google ログインは本物のトークンを返さないことがある。手元ではカレンダーを呼ばないので、見本の値で進める
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? (local ? 'emulator-sample-token' : undefined)
    if (!token) throw new Error('no access token')
    return { kind: 'ready', token: holdCalendarToken(token) }
  } catch (cause) {
    // その Google アカウントが、もうほかの自分につないである：切り替えて読み込み直したあとに使うトークンを渡しておく
    if ((cause as AuthError).code === 'auth/credential-already-in-use') {
      passCalendarToken(GoogleAuthProvider.credentialFromError(cause as AuthError)?.accessToken)
    }
    try {
      const outcome = await settle(auth, functions, user, cause, true)
      if (outcome !== 'switched') keep(CALENDAR_TOKEN, null)
      return outcome === 'switched' ? { kind: 'switched' } : { kind: 'cancelled' }
    } catch (failure) {
      // 切り替えられなかったら、渡すつもりだったトークンを残さない
      keep(CALENDAR_TOKEN, null)
      throw failure
    }
  }
}

// 読み込み直しをまたいで受け取ったトークン。開発時の StrictMode で受け取りが 2 回呼ばれても、同じトークンを返す
let resumedToken: string | null = null

/** 読み込み直す前（ログインの画面から戻った、アカウントを切り替えた）にもらったトークンを受け取る。なければ null */
export function takeGoogleCalendarToken(): string | null {
  const token = take(CALENDAR_TOKEN)
  if (token) resumedToken = holdCalendarToken(token)
  return resumedToken && calendarToken?.token === resumedToken ? resumedToken : null
}

/** 持っているトークンを捨てる（Calendar API が「許可が切れた」と断ったとき。次は Google のポップアップを出す） */
export function forgetGoogleCalendarToken(): void {
  calendarToken = null
  resumedToken = null
}

/**
 * つないだ直後に呼ぶ。ログインの画面から戻ってきたところなら、連携の続きを行う。
 * 引き継ぎがやり残しなら、やり直す。どちらでもなければ、何もしない（余計な通信をしない）
 */
export async function finishGoogleRedirect(auth: Auth, functions: Functions): Promise<void> {
  const user = auth.currentUser
  if (user && take(REDIRECT_PENDING)) {
    // カレンダーの許可をもらうために移ったか（link：連携も一緒にした、reauth：連携済みの人の確かめ直し）
    const calendar = take(CALENDAR_REDIRECT)
    try {
      const result = await getRedirectResult(auth)
      if (result && calendar) passCalendarToken(GoogleAuthProvider.credentialFromResult(result)?.accessToken)
      if (result && calendar !== 'reauth') noteLinkOutcome({ kind: 'linked' })
    } catch (cause) {
      if (calendar && (cause as AuthError).code === 'auth/credential-already-in-use') {
        passCalendarToken(GoogleAuthProvider.credentialFromError(cause as AuthError)?.accessToken)
      }
      try {
        const outcome = await settle(auth, functions, user, cause, false)
        if (outcome === 'switched') noteLinkOutcome({ kind: 'switched' })
      } catch (failure) {
        console.error(failure)
        keep(CALENDAR_TOKEN, null)
        noteLinkOutcome({ kind: 'failed', code: (failure as { code?: unknown } | null)?.code })
      }
    }
  }
  if (auth.currentUser && !auth.currentUser.isAnonymous) await movePending(functions)
}

/** 読み込み直したあとの画面で、結果を知らせるために覚えておく */
export function noteLinkOutcome(outcome: Parameters<typeof encodeLinkOutcome>[0]): void {
  keep(LINK_OUTCOME, encodeLinkOutcome(outcome))
}

// ページを開いてから最初に読んだ結果。読んだ時点で sessionStorage からは消す
// （このあと画面の描画に失敗しても、開き直したときに同じ結果を読み直さないように）
let pendingOutcome: LinkOutcome | null | undefined

/** 覚えておいた結果を読む。clearLinkOutcome を呼ぶまでは、何度読んでも同じ結果が返る */
export function readLinkOutcome(): LinkOutcome | null {
  if (pendingOutcome === undefined) pendingOutcome = parseLinkOutcome(take(LINK_OUTCOME))
  return pendingOutcome
}

/** 結果を知らせ終えたら呼ぶ */
export function clearLinkOutcome(): void {
  pendingOutcome = null
}

/** ログアウトする。次につないだときに、新しい匿名の人になる */
export async function logout(auth: Auth): Promise<void> {
  // 読み込み直すまで、前の人の購読がエラーを出すので、先に画面を隠す
  markSwitching(auth, true)
  try {
    await signOut(auth)
  } catch (failure) {
    markSwitching(auth, false)
    throw failure
  }
}
