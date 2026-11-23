import { translate as t } from '@/shared/lib'
import { Button, Field, TextInput } from '@/shared/ui'
import { originDisplayName } from '../model/originPlaces'
import {
  TRIP_ORIGIN_MAX,
  TRIP_TITLE_MAX,
  type TripInfo,
  tripNightsLabel,
  withEndDate,
  withStartDate,
} from '../model/tripInfo'
import styles from './TripInfoFields.module.css'

/** すぐ選べる出発地。打つ手間を減らすためのもので、自由に書き換えられる */
const ORIGIN_SHORTCUTS = ['東京駅', '新宿駅', '大阪駅']

interface Props {
  value: TripInfo
  onChange: (value: TripInfo) => void
}

/**
 * 旅の基本情報の入力欄（S01）。決めるのはタイトル・日程・出発地だけ。
 * 行き先やエリアは選ばせない（みんなでマップに書いていく）。
 */
export function TripInfoFields({ value, onChange }: Props) {
  const set = (patch: Partial<TripInfo>) => onChange({ ...value, ...patch })
  const nights = tripNightsLabel(value)

  return (
    <div className={styles.fields}>
      <Field label={t('旅のタイトル', 'Trip name')}>
        <TextInput
          name="title"
          value={value.title}
          maxLength={TRIP_TITLE_MAX}
          placeholder={t('例：秋の信州ふらり旅', 'e.g. Autumn in Nagano')}
          autoComplete="off"
          enterKeyHint="next"
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>

      <div className={styles.group}>
        <div className={styles.groupHeader}>
          <span className={styles.groupLabel}>{t('日程', 'Dates')}</span>
          {nights && <span className={styles.nights}>{nights}</span>}
        </div>
        <div className={styles.dates}>
          <Field label={t('開始日', 'Start date')} small>
            <TextInput
              type="date"
              name="startDate"
              value={value.startDate}
              onChange={(event) => onChange(withStartDate(value, event.target.value))}
            />
          </Field>
          <span className={styles.tilde} aria-hidden="true">
            〜
          </span>
          <Field label={t('終了日（なしなら日帰り）', 'End date (optional for day trips)')} small>
            <TextInput
              type="date"
              name="endDate"
              value={value.endDate ?? ''}
              min={value.startDate}
              onChange={(event) => onChange(withEndDate(value, event.target.value))}
            />
          </Field>
        </div>
        {value.endDate && (
          <div className={styles.right}>
            <Button size="small" onClick={() => set({ endDate: null })}>
              {t('終了日をなしにする（日帰り）', 'Make it a day trip')}
            </Button>
          </div>
        )}
      </div>

      <div className={styles.group}>
        <Field label={t('出発地（集合場所）', 'Departure point (meeting place)')}>
          <TextInput
            name="origin"
            value={value.origin}
            maxLength={TRIP_ORIGIN_MAX}
            placeholder={t('例：東京駅', 'e.g. Tokyo Station')}
            autoComplete="off"
            enterKeyHint="next"
            onChange={(event) => set({ origin: event.target.value })}
          />
        </Field>
        <div className={styles.chips}>
          {ORIGIN_SHORTCUTS.map((origin) => (
            <Button key={origin} size="small" onClick={() => set({ origin: originDisplayName(origin) })}>
              {originDisplayName(origin)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
