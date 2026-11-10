import type { ReactNode } from 'react'
import { UnlockAiForm } from '@/features/unlock-ai'
import { Icon, Loading, Screen } from '@/shared/ui'
import { useAppLock } from '../model/useAppLock'
import styles from './AppLock.module.css'

/**
 * アプリ全体の合言葉の画面。本番では、合言葉を通すまで、どの URL を開いてもこの画面だけを出す
 * （地図も読み込まない）。通ったら、開こうとしていた画面をそのまま出す。
 */
export function AppLock({ children }: { children: ReactNode }) {
  const { state, open } = useAppLock()

  if (state === 'open') return children
  if (state === 'checking') return <Loading />

  return (
    <Screen>
      <header className={styles.brand}>
        <Icon name="pin" size={30} />
        <h1 className={styles.brandName}>たびむすび</h1>
      </header>

      <div className={styles.body}>
        <h2 className={styles.title}>合言葉を入れてください</h2>
        <p className={styles.lead}>このアプリは今、合言葉を知っている人だけが使えます。</p>
        <UnlockAiForm onDone={open} />
        <p className={styles.note}>
          審査員の方へ：合言葉はプロダクト説明ドキュメントの「デプロイした URL」の欄に書いてあります。
        </p>
      </div>
    </Screen>
  )
}
