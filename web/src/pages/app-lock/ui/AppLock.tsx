import { translate as t } from '@/shared/lib'
import type { ReactNode } from 'react'
import { UnlockAiForm } from '@/features/unlock-ai'
import { Icon, LanguageSwitcher, Loading, Screen } from '@/shared/ui'
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
        <h1 className={styles.brandName}>{t('たびむすび', 'Tabimusubi')}</h1>
        <LanguageSwitcher />
      </header>

      <div className={styles.body}>
        <h2 className={styles.title}>{t('合言葉を入れてください', 'Enter the app passphrase')}</h2>
        <p className={styles.lead}>{t('このアプリは今、合言葉を知っている人だけが使えます。', 'This app currently requires a passphrase.')}</p>
        <UnlockAiForm onDone={open} />
        <p className={styles.note}>
          {t('審査員の方へ：合言葉はプロダクト説明ドキュメントの「デプロイした URL」の欄に書いてあります。', 'For judges, the passphrase is in the Deployed URL section of the product description.')}
        </p>
      </div>
    </Screen>
  )
}
