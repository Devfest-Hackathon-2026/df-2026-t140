import { UnlockAiForm } from '@/features/unlock-ai'
import { ButtonLink, ErrorText, Icon, Loading, Screen, SoundControls, useToast } from '@/shared/ui'
import { TripList } from '@/widgets/trip-list'
import { useMenu } from '../model/useMenu'
import styles from './MenuPage.module.css'

/**
 * ホーム（M01）。計画中の旅の一覧と、旅の切り替え、新しい旅をつくる入口。
 * アカウントのログインは求めない。匿名ログインなので、この端末で参加した旅だけが並ぶ。
 */
export function MenuPage() {
  const { loading, failed, trips, currentTripId, aiUnlocked } = useMenu()
  const toast = useToast()

  if (loading) return <Loading />

  return (
    <Screen>
      <header className={styles.brand}>
        <Icon name="pin" size={30} />
        <h1 className={styles.brandName}>たびむすび</h1>
        <SoundControls />
      </header>

      {failed && <ErrorText>旅の一覧を読み込めませんでした。もう一度開いてください。</ErrorText>}

      {trips.length === 0 ? (
        <div className={styles.hero}>
          <h2 className={styles.heroTitle}>みんなで、旅を建てよう。</h2>
          <p className={styles.lead}>
            決めるのは、タイトル・日程・出発地だけ。行き先はみんなでマップに書いていきます。
          </p>
        </div>
      ) : (
        <>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>計画中の旅</h2>
            <span>{trips.length}件</span>
          </div>
          <TripList memberships={trips} currentTripId={currentTripId} />
        </>
      )}

      {trips.length === 0 ? (
        <ButtonLink to="/new" variant="go" size="large" block>
          <Icon name="plus" />
          旅をつくる
        </ButtonLink>
      ) : (
        <ButtonLink to="/new" variant="dashed" size="large" block>
          <Icon name="plus" />
          新しい旅をつくる
        </ButtonLink>
      )}

      {!aiUnlocked && (
        <details className={styles.ai}>
          <summary className={styles.aiSummary}>合言葉を知っている人へ</summary>
          <p className={styles.aiLead}>合言葉を入れると、あなたが書いた希望の場所を本物の AI が探します。</p>
          <UnlockAiForm onDone={() => toast('本物の AI が使えるようになりました')} />
        </details>
      )}
    </Screen>
  )
}
