import { Outlet, useParams } from 'react-router'
import { JoinTripForm } from '@/features/join-trip'
import { ButtonLink, Card, ErrorText, HomeButton, Loading, Screen } from '@/shared/ui'
import { useTripGate } from '../model/useTripGate'
import styles from './TripGatePage.module.css'

/**
 * /t/:tripId より下の画面の入口。メンバーなら中の画面（地図など）を出し、
 * メンバーでなければ、表示名を入れて参加する画面を出す。この URL がそのまま招待 URL になる。
 * 旅の中の画面を足すときは、app/router.tsx でこの下に並べる。
 */
export function TripGatePage() {
  const { tripId = '' } = useParams()
  const { loading, isMember, failed } = useTripGate(tripId)

  if (loading) return <Loading />
  if (isMember) return <Outlet />

  return (
    <Screen>
      <div className={styles.top}>
        <HomeButton />
      </div>
      <div className={styles.hero}>
        <h1 className={styles.title}>旅に招待されています</h1>
        <p className={styles.lead}>
          名前を入れるだけで、同じマップで一緒に計画できます。行き先はみんなで決めます。
        </p>
      </div>
      <Card>
        {failed ? (
          <>
            <ErrorText>この旅を開けませんでした。電波のよいところで、もう一度開いてください。</ErrorText>
            <ButtonLink to="/" block>
              ホームへ
            </ButtonLink>
          </>
        ) : (
          <JoinTripForm tripId={tripId} />
        )}
      </Card>
    </Screen>
  )
}
