import { translate as t } from '@/shared/lib'
import { useNavigate } from 'react-router'
import { JoinByCodeForm } from '@/features/join-by-code'
import { GoogleLink } from '@/features/link-google'
import { UnlockAiForm } from '@/features/unlock-ai'
import { ButtonLink, Card, ErrorText, Icon, LanguageSwitcher, Loading, Screen, SoundControls, useToast } from '@/shared/ui'
import { HomeFooter } from '@/widgets/home-footer'
import { FinalShioriList, TripList } from '@/widgets/trip-list'
import { TutorialButton } from '@/widgets/tutorial'
import { useMenu } from '../model/useMenu'
import styles from './MenuPage.module.css'

/**
 * ホーム（M01）。計画中の旅の一覧と、その下に決まったしおりの一覧と過去の旅の一覧、旅の切り替え、新しい旅をつくる入口、旅の合言葉で参加する入口。
 * アカウントのログインは求めない。匿名ログインなら、この端末で参加した旅だけが並ぶ。
 * Google アカウントと連携した人には、どの端末でも同じ旅が並ぶ（連携は任意）。
 * 一番下にフッター（ホームとコレクションの切り替え。企画書「ユーザー体験」4-2）。
 */
export function MenuPage() {
  const { loading, failed, trips, finals, pasts, hasTrips, currentTripId, aiUnlocked } = useMenu()
  const toast = useToast()
  const navigate = useNavigate()

  if (loading) return <Loading />

  return (
    <Screen>
      <header className={styles.brand}>
        <Icon name="pin" size={30} />
        <h1 className={styles.brandName}>{t('たびむすび', 'Tabimusubi')}</h1>
        <LanguageSwitcher />
        <SoundControls />
      </header>

      {failed && <ErrorText>{t('旅の一覧を読み込めませんでした。もう一度開いてください。', 'Could not load your trips. Reopen the app and try again.')}</ErrorText>}

      {!hasTrips ? (
        <div className={styles.hero}>
          <h2 className={styles.heroTitle}>{t('みんなで、旅を建てよう。', 'Build a trip together.')}</h2>
          <p className={styles.lead}>
            {t('決めるのは、タイトル・日程・出発地だけ。行き先はみんなでマップに書いていきます。', 'Start with a name, dates, and a departure point. Then everyone can add destinations to the map.')}
          </p>
        </div>
      ) : (
        <>
          {trips.length > 0 && (
            <>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>{t('計画中の旅', 'Trips in planning')}</h2>
                <span>{t(`${trips.length}件`, String(trips.length))}</span>
              </div>
              <TripList memberships={trips} currentTripId={currentTripId} />
            </>
          )}
          {finals.length > 0 && (
            <>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>{t('決まったしおり', 'Final itineraries')}</h2>
                <span>{t(`${finals.length}件`, String(finals.length))}</span>
              </div>
              <FinalShioriList trips={finals} />
            </>
          )}
          {pasts.length > 0 && (
            <>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>{t('過去の旅', 'Past trips')}</h2>
                <span>{t(`${pasts.length}件`, String(pasts.length))}</span>
              </div>
              <FinalShioriList trips={pasts} past />
            </>
          )}
        </>
      )}

      {!hasTrips ? (
        <ButtonLink to="/new" variant="go" size="large" block>
          <Icon name="plus" />
          {t('旅をつくる', 'Create a trip')}
        </ButtonLink>
      ) : (
        <ButtonLink to="/new" variant="go" size="large" block>
          <Icon name="plus" />
          {t('新しい旅をつくる', 'Create a new trip')}
        </ButtonLink>
      )}

      <Card className={styles.join}>
        {/* 旅の画面を開く。メンバーでなければ、参加の画面（名前を入れる画面）になる */}
        <JoinByCodeForm onFound={(tripId) => void navigate(`/t/${tripId}`)} />
      </Card>

      <GoogleLink place="home" />

      {/* チュートリアルを見返す（初めて開いたときに出るものと同じ） */}
      <TutorialButton />

      {!aiUnlocked && (
        <details className={styles.ai}>
          {/* 旅の合言葉（上の欄）と区別がつくよう、AI のための合言葉だと書く（UI/UX レビューの H-1。#708。文は仮） */}
          <summary className={styles.aiSummary}>{t('AI を使うための合言葉を知っている人へ', 'Have an AI passphrase?')}</summary>
          <p className={styles.aiLead}>{t('合言葉を入れると、あなたが書いた希望の場所を本物の AI が探します。', 'Enter the passphrase to let AI find places based on your wishes.')}</p>
          <UnlockAiForm onDone={() => toast(t('本物の AI が使えるようになりました', 'AI suggestions are now available'))} />
        </details>
      )}

      <HomeFooter current="home" />
    </Screen>
  )
}
