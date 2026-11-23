import { translate as t, useElementHeight } from '@/shared/lib'
import { Button, ButtonLink, Icon, Loading } from '@/shared/ui'
import { BuildingFloat } from '@/widgets/collection'
import { TripMap } from '@/widgets/trip-map'
import { useCollectionMap } from '../model/useCollectionMap'
import styles from './CollectionMapPage.module.css'

/** 建物の模型の、画面の上での大きさのもと（px）。引いて見る画面なので、旅の地図（140）より小さくする */
const BUILDING_SIZE = 110

const ignore = () => {}

/**
 * 日本コレクション（企画書「ユーザー体験」4-3）。過去のすべての旅の建物を、日本全体の地図に並べる。
 * 地図は旅の地図と同じ部品で、最初は日本全体を映す。近い建物は 1 つにまとめて数を出す。建物を押すと建物の詳細（重ねて出す）。
 * 下に並ぶ旅の名前を押すと、その旅の建物が全部入る所へ寄る。左上の戻るボタンでコレクションへ
 */
export function CollectionMapPage() {
  const { loading, trips, pins, members, models, total, selected, select, close, focus, focusTrip } = useCollectionMap()
  const [topRef, topHeight] = useElementHeight()
  const [bottomRef, bottomHeight] = useElementHeight()

  // 建物を読み終えてから地図を出す（読み込みの途中で、建物が少しずつ増えて見えないように）
  if (loading) return <Loading />

  return (
    <div className={styles.page}>
      <TripMap
        pins={pins}
        members={members}
        models={models}
        celebratingPinId={null}
        // 詳細を出している建物は、地図には伝えない（伝えると、詳細の裏で地図がその建物へ寄り、閉じても戻らない）
        selectedPinId={null}
        onSelectPin={select}
        onViewChange={ignore}
        focus={focus}
        topInset={topHeight}
        bottomInset={bottomHeight}
        buildingSize={BUILDING_SIZE}
        startWhole
      />

      <header className={styles.top} ref={topRef}>
        <ButtonLink to="/collection" sound="close" iconOnly aria-label={t('コレクションへ戻る', 'Back to the collection')}>
          <Icon name="back" />
        </ButtonLink>
        <div className={styles.band}>
          <h1 className={styles.title}>{t('日本コレクション', 'Japan collection')}</h1>
          <span className={styles.count}>{t(`建物 ${total}`, `Buildings: ${total}`)}</span>
        </div>
      </header>

      <section className={styles.bottom} ref={bottomRef} aria-label={t('これまでの旅', 'Past trips')}>
        {trips.length === 0 ? (
          <p className={styles.blank}>{t('旅程を確定した旅が終わると、ここに建物が並びます。', 'Buildings from trips with finalized itineraries appear here after the trip ends.')}</p>
        ) : (
          <>
            <h2 className={styles.label}>{t(`これまでの旅　${trips.length}件`, `Past trips: ${trips.length}`)}</h2>
            <ul className={styles.trips}>
              {trips.map(({ trip, buildings }) => (
                <li key={trip.id}>
                  <Button sound="select" size="small" disabled={buildings.length === 0} onClick={() => focusTrip(trip.id)}>
                    {trip.title}
                    <span className={styles.tripCount}>{buildings.length}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {selected && <BuildingFloat key={selected.key} building={selected} onClose={close} />}
    </div>
  )
}
