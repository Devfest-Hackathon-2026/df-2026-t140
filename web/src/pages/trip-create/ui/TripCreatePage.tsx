import { useNavigate } from 'react-router'
import { CreateTripForm } from '@/features/create-trip'
import { Card, HomeButton, Screen } from '@/shared/ui'
import styles from './TripCreatePage.module.css'

/** 旅をつくる（S01）。作れたら旅の画面へ移り、友達を招待するシートを出す */
export function TripCreatePage() {
  const navigate = useNavigate()

  return (
    <Screen>
      <div className={styles.top}>
        <HomeButton />
      </div>
      <div className={styles.hero}>
        <h1 className={styles.title}>みんなで、旅を建てよう。</h1>
        <p className={styles.lead}>
          決めるのは、タイトル・日程・出発地だけ。行き先はみんなでマップに書いていきます。
        </p>
      </div>
      <Card>
        <CreateTripForm onCreated={(tripId) => navigate(`/t/${tripId}`, { state: { invite: true } })} />
      </Card>
    </Screen>
  )
}
