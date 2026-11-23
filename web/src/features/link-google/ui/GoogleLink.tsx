import { translate as t } from '@/shared/lib'
import { Button, ErrorText } from '@/shared/ui'
import { useGoogleLink } from '../model/useGoogleLink'
import styles from './GoogleLink.module.css'
import { GoogleMark } from './GoogleMark'

interface Props {
  /**
   * home：ホーム（M01）。連携の案内と、連携したあとの状態（アカウントとログアウト）を出す。
   * join：招待された人の参加の画面。前に参加したことがある人がログインする入口だけを出す
   */
  place: 'home' | 'join'
}

/** Google アカウントとの連携（任意）。連携しなくても、名前だけで使える */
export function GoogleLink({ place }: Props) {
  const { account, busy, problem, link, logout } = useGoogleLink()

  if (account.google) {
    // 参加の画面では、ログインしたあとに出すものはない（そのまま名前を入れて参加する）
    if (place === 'join') return null
    return (
      <section className={styles.box} aria-label={t('Google アカウントとの連携', 'Google account connection')}>
        <div className={styles.linked}>
          <GoogleMark size={24} />
          <div className={styles.who}>
            <span className={styles.title}>{t('Google アカウントと連携しています', 'Google account connected')}</span>
            {account.email && <span className={styles.email}>{account.email}</span>}
          </div>
        </div>
        <p className={styles.lead}>{t('ほかの端末やブラウザでも、同じアカウントでログインすると、同じ旅を開けます。', 'Sign in with the same Google account on another device or browser to open your trips.')}</p>
        <ErrorText>{problem}</ErrorText>
        <div className={styles.logout}>
          <Button size="small" variant="text" disabled={busy} onClick={() => void logout()}>
            {t('ログアウト', 'Sign out')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.box} aria-label={t('Google アカウントとの連携', 'Google account connection')}>
      {place === 'home' ? (
        // 見出しと添え書きは、かめが決めた文言（2026-11-16 の会話）。案内の文は置かない
        <h2 className={styles.title}>
          {t('次回も計画を続けよう', 'Pick up where you left off')}
          {/* 英語では、見出しと添え書きの間に空白を入れる（日本語は括弧が間をあけるので入れない） */}
          {t('', ' ')}
          <span className={styles.note}>{t('（ログインもこちらから！）', 'You can also sign in here.')}</span>
        </h2>
      ) : (
        <>
          <h2 className={styles.title}>{t('前にこの旅に参加した人へ', 'Already joined this trip?')}</h2>
          <p className={styles.lead}>
            {t('Google アカウントと連携してあれば、ログインすると、前と同じ人としてこの旅を開けます。', 'Sign in with the Google account you connected to reopen this trip.')}
          </p>
        </>
      )}
      <Button block disabled={busy} onClick={() => void link()}>
        <GoogleMark />
        {place === 'home' ? t('Google アカウントと連携する', 'Connect a Google account') : t('Google アカウントでログイン', 'Sign in with Google')}
      </Button>
      <ErrorText>{problem}</ErrorText>
    </section>
  )
}
