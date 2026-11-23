import { type PickedPrefectures, pickedLabel, TRAVEL_MODE_LABELS, type TravelMode } from '@/entities/trip'
import { nightsLabel, translate as t } from '@/shared/lib'
import { Button, HomeButton, Icon } from '@/shared/ui'
import { HeaderBadge, TripHeader } from '@/widgets/trip-header'
import { shortPlaces } from '../model/tripQuiz'
import styles from './QuizHeader.module.css'

interface Props {
  /** 日程（選ぶまでは null） */
  dates: { start: string; end: string | null } | null
  mode: TravelMode | null
  /** 選んだ県（場所を選ぶ画面と、そのあとの旅の名前の問い） */
  picked?: PickedPrefectures
  /** 戻るボタン。最初の問いでは押せない */
  onBack: () => void
  backDisabled?: boolean
}

/**
 * 旅をつくる画面の上の帯。旅の画面の帯（widgets/trip-header）と同じ形で、左に戻る、まん中に「新しい旅」と答えた印、右にホーム。
 * 旅の名前は最後の問いで決めるので、ここでは「新しい旅」と出す（旅の画面の帯と同じ言葉）。
 * 印は、答えるたびに増える（日程は青、乗り物は青の絵だけ、場所は緑）。左右のボタンは、帯が 2 段になっても縦に伸ばさない
 */
export function QuizHeader({ dates, mode, picked, onBack, backDisabled }: Props) {
  const places = picked && picked.length > 0 ? shortPlaces(picked) : null
  const badges =
    dates || mode || places ? (
      <>
        {dates && (
          <span key={`${dates.start}-${dates.end}`} className={styles.pop}>
            <HeaderBadge tone="route" icon="calendar" label={t(`日程：${nightsLabel(dates.start, dates.end)}`, `Duration: ${nightsLabel(dates.start, dates.end)}`)}>
              {nightsLabel(dates.start, dates.end)}
            </HeaderBadge>
          </span>
        )}
        {mode && (
          <span key={mode} className={styles.pop}>
            <HeaderBadge tone="route" icon={mode === 'transit' ? 'train' : mode} label={t(`乗り物：${TRAVEL_MODE_LABELS[mode]}`, `Transport: ${TRAVEL_MODE_LABELS[mode]}`)}>
              {null}
            </HeaderBadge>
          </span>
        )}
        {places && (
          <span key={places} className={styles.pop}>
            <HeaderBadge tone="go" icon="map" label={t(`大まかな場所：${pickedLabel(picked ?? [])}`, `Destination area: ${pickedLabel(picked ?? [])}`)}>
              {places}
            </HeaderBadge>
          </span>
        )}
      </>
    ) : undefined

  return (
    <div className={styles.header}>
      <TripHeader
        title={t('新しい旅', 'New trip')}
        left={
          <span className={styles.side}>
            <Button iconOnly aria-label={t('ひとつ前の質問へ', 'Previous question')} disabled={backDisabled} onClick={onBack}>
              <Icon name="back" />
            </Button>
          </span>
        }
        badges={badges}
        right={
          <span className={styles.side}>
            <HomeButton />
          </span>
        }
      />
    </div>
  )
}
