import { SessionProvider } from '@/shared/api'
import { simFrame, useSounds, translate as t } from '@/shared/lib'
import { AppLock } from '@/pages/app-lock'
import { DevSimPage } from '@/pages/dev-sim'
import { ErrorBoundary, ErrorText, Loading, Screen, ToastProvider } from '@/shared/ui'
import { FirstRunTutorial } from '@/widgets/tutorial'
import { UsagePanel } from '@/widgets/usage-panel'
import { AppRouter } from './router'

/** アプリの起動。匿名ログイン、お知らせの枠、合言葉の確認（本番だけ）、画面の切り替えを重ねる */
export function App() {
  useSounds()
  // 開発用の画面（複数人シミュレーション、/dev/sim）。開発サーバーのときだけ。本番のビルドには入らない。
  // 3 つの画面（iframe）が中で Firebase につなぐので、この親の画面は Firebase につながない（SessionProvider の外）
  if (import.meta.env.DEV && location.pathname === '/dev/sim') return <DevSimPage />
  return (
    <ErrorBoundary>
      {/* 初めて開いた端末では、接続や合言葉より先にチュートリアルを出す（見終えたら、開こうとしていた画面へ） */}
      <FirstRunTutorial>
        <SessionProvider
          // 複数人シミュレーションの中の画面なら、画面ごとに別の匿名ユーザーにする
          appName={simFrame?.appName}
          fallback={<Loading label={t('つないでいます…', 'Connecting…')} />}
          renderError={() => (
            <Screen>
              <ErrorText>{t('つながりませんでした。電波のよいところで、もう一度開いてください。', 'Could not connect. Check your connection and reopen the app.')}</ErrorText>
            </Screen>
          )}
        >
          <ToastProvider>
            <AppLock>
              <AppRouter />
              {/* API の使用量（デバッグ用）。PC の幅で、合言葉を通した人にだけ、スマホの画面の外側に出す */}
              <UsagePanel />
            </AppLock>
          </ToastProvider>
        </SessionProvider>
      </FirstRunTutorial>
    </ErrorBoundary>
  )
}
