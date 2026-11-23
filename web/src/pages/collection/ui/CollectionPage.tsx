import { Link } from 'react-router'
import { ModelSprite } from '@/entities/model3d'
import { CategoryIcon, pinDisplayName } from '@/entities/pin'
import { dateRangeLabel, playSound, translate as t } from '@/shared/lib'
import { ButtonLink, ErrorText, Icon, Loading, Screen } from '@/shared/ui'
import { BuildingFloat, type CollectionBuilding } from '@/widgets/collection'
import { HomeFooter } from '@/widgets/home-footer'
import { useCollectionPage } from '../model/useCollectionPage'
import styles from './CollectionPage.module.css'

/** タイルに描く模型の絵の大きさ（px）。タイルの幅に合わせて CSS で縮める */
const SPRITE_SIZE = 160

/**
 * コレクション（企画書「ユーザー体験」4-2）。過去の旅で建てた建物を、旅ごとにまとめて四角いタイルで並べる。
 * 旅ごとの「しおり」でその旅の決まったしおり（S14）へ、タイルを押すと建物の詳細（重ねて出す）、
 * 一番上の「日本地図で見る」で日本コレクションへ。下にフッター（ホームとの切り替え）
 */
export function CollectionPage() {
  const { loading, failed, trips, total, selected, select, close } = useCollectionPage()

  if (loading) return <Loading />

  return (
    <Screen>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('コレクション', 'Collection')}</h1>
        {trips.length > 0 && (
          <span className={styles.count}>
            {t(`旅 ${trips.length}・建物 ${total}`, `Trips: ${trips.length} · Buildings: ${total}`)}
          </span>
        )}
      </header>

      {failed && <ErrorText>{t('コレクションを読み込めませんでした。もう一度開いてください。', 'Could not load the collection. Reopen the page and try again.')}</ErrorText>}

      {trips.length === 0 ? (
        // 読めなかったときは、エラーの文だけを出す（過去の旅がないように読めるので、案内は出さない）
        !failed && <p className={styles.blank}>{t('終わった旅がここに並びます', 'Finished trips appear here')}</p>
      ) : (
        <>
          <Link
            to="/collection/map"
            className={styles.japan}
            onClick={(event) => {
              if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) playSound('open')
            }}
          >
            <span className={styles.japanIcon}>
              <Icon name="map" size={28} />
            </span>
            <span className={styles.japanText}>
              <span className={styles.japanTitle}>{t('日本地図で見る', 'View on a map of Japan')}</span>
              <span className={styles.japanLead}>{t('建物を日本地図に並べます', 'See your buildings across Japan')}</span>
            </span>
            <Icon name="chevron" size={20} />
          </Link>

          {trips.map(({ trip, buildings }) => (
            <section key={trip.id} className={styles.group}>
              <div className={styles.groupHead}>
                <div className={styles.groupText}>
                  <h2 className={styles.groupTitle}>{trip.title}</h2>
                  <p className={styles.groupMeta}>
                    {dateRangeLabel(trip.startDate, trip.endDate)}{t(`・建物 ${buildings.length}`, ` · Buildings: ${buildings.length}`)}
                  </p>
                </div>
                <ButtonLink to={`/t/${trip.id}/final`} variant="route" size="small" aria-label={t(`${trip.title}のしおりを開く`, `Open itinerary for ${trip.title}`)}>
                  <Icon name="bookmark" size={18} />
                  {t('しおり', 'Itinerary')}
                </ButtonLink>
              </div>
              <ul className={styles.grid}>
                {buildings.map((building) => (
                  <li key={building.key}>
                    <BuildingTile building={building} onSelect={() => select(building.key)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {selected && <BuildingFloat key={selected.key} building={selected} onClose={close} />}
      <HomeFooter current="collection" />
    </Screen>
  )
}

/** 建物のタイル。模型を斜め上から見た絵と、場所の名前。模型をまだ読めていないあいだは、場所の種類の絵を出す */
function BuildingTile({ building, onSelect }: { building: CollectionBuilding; onSelect: () => void }) {
  const { pin, model } = building
  return (
    <button type="button" className={styles.tile} onClick={onSelect}>
      <span className={styles.picture}>
        {model ? <ModelSprite model={model} size={SPRITE_SIZE} className={styles.sprite} /> : <CategoryIcon category={pin.category} size={28} />}
      </span>
      <span className={styles.tileName}>{pinDisplayName(pin)}</span>
    </button>
  )
}
