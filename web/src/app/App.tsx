import { SessionProvider } from '@/shared/api'
import { simFrame, useSounds } from '@/shared/lib'
import { AppLock } from '@/pages/app-lock'
import { DevSimPage } from '@/pages/dev-sim'
import { ErrorBoundary, ErrorText, Loading, Screen, ToastProvider } from '@/shared/ui'
import { AppRouter } from './router'

/** アプリの起動。匿名ログイン、お知らせの枠、合言葉の確認（本番だけ）、画面の切り替えを重ねる */
export function App() {
  useSounds()
  // 開発用の画面（複数人シミュレーション、/dev/sim）。開発サーバーのときだけ。本番のビルドには入らない。
  // 3 つの画面（iframe）が中で Firebase につなぐので、この親の画面は Firebase につながない（SessionProvider の外）
  if (import.meta.env.DEV && location.pathname === '/dev/sim') return <DevSimPage />
  return (
    <ErrorBoundary>
      <SessionProvider
        // 複数人シミュレーションの中の画面なら、画面ごとに別の匿名ユーザーにする
        appName={simFrame?.appName}
        fallback={<Loading label="つないでいます…" />}
        renderError={() => (
          <Screen>
            <ErrorText>つながりませんでした。電波のよいところで、もう一度開いてください。</ErrorText>
          </Screen>
        )}
      >
        <ToastProvider>
          <AppLock>
            <AppRouter />
          </AppLock>
        </ToastProvider>
      </SessionProvider>
    </ErrorBoundary>
  )
}
