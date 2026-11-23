import { createContext, createElement, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { isSwitchingAccount, subscribeSwitching } from './switching'
import { connect, type Session } from './connect'

const SessionContext = createContext<Session | null>(null)

/**
 * 匿名ログイン済みの接続。SessionProvider の下の、model のフックで使う
 * （ui の部品からは直接使わず、model のフックを通す）。
 */
export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('SessionProvider の下で使ってください')
  return session
}

interface Props {
  /** 同じブラウザの中で別の人として動かすときに変える（複数人シミュレーション用） */
  appName?: string
  /** つないでいる間に出すもの */
  fallback?: ReactNode
  /** つながらなかったときに出すもの */
  renderError?: (message: string) => ReactNode
  children: ReactNode
}

/**
 * Firebase につないで匿名ログインし、下の画面に接続を渡す。
 * 見た目は持たない（つないでいる間と失敗したときに出すものは、呼ぶ側が渡す）。
 * Google アカウントへの切り替えやログアウトで人が変わるときは、読み込み直すまで fallback を出す。
 */
export function SessionProvider({ appName, fallback = null, renderError, children }: Props): ReactNode {
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState<string>()
  // 人を切り替えている（このあと読み込み直す）あいだは、下の画面を外して、つないでいる間と同じものを出す
  const switching = useSyncExternalStore(subscribeSwitching, () => Boolean(session && isSwitchingAccount(session.auth)))

  useEffect(() => {
    let cancelled = false
    connect(appName).then(
      (value) => !cancelled && setSession(value),
      (cause: Error) => {
        console.error(cause)
        if (!cancelled) setError(cause.message)
      },
    )
    return () => {
      cancelled = true
    }
  }, [appName])

  if (error) return renderError ? renderError(error) : null
  if (!session || switching) return fallback
  return createElement(SessionContext, { value: session }, children)
}
