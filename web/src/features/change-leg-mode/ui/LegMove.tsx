import { translate } from '@/shared/lib'
import { durationLabel, type LegFlight, type LegMode } from '@/entities/route'
import { Icon, type IconName } from '@/shared/ui'
import { flightView, LEG_MODE_LABELS, useChangeLegMode } from '../model/useChangeLegMode'
import styles from './LegMove.module.css'

const ICONS: Record<LegMode, IconName> = { transit: 'train', car: 'car', walk: 'walk', plane: 'plane' }


interface Props {
  tripId: string
  routeId: string
  from: string
  to: string
  /** 次の場所までの目安の時間（分） */
  minutes: number
  /** この区間の手段（選んだもの、なければ区間の既定） */
  mode: LegMode
  /** この区間だけ手段を選んでいるか */
  chosen: boolean
  /** 区間の既定（ふつうは旅全体の手段。遠い区間と島への区間は飛行機） */
  tripMode: LegMode
  /** この区間で徒歩を選べるか（直線 10 km より遠ければ選べない） */
  walkable: boolean
  /** この区間で飛行機を選べるか（直線 200 km より近ければ、飛行機は出さない） */
  planeable: boolean
  /** 飛行機の区間の行き方（ルートの legFlights） */
  flight?: LegFlight
  /** 旅程が確定していて、手段を選び直せない（手段と時間を出すだけ。features/confirm-shiori） */
  locked?: boolean
}

/**
 * しおり（S11）の行のあいだの、次の場所までの移動の行。手段と目安の時間を出し、押すとこの区間だけ手段を選び直せる。
 * 飛行機は直線 200 km より遠い区間だけに出す。飛行機の区間には、時刻表から選んだ便（押さなくても、しおりを作る・組み直すときに探してある。#482）と、時刻表の出典・取得日・問い合わせ先を出す
 * （公共交通オープンデータ開発者ガイドライン 2.2.1、3.1）
 */
export function LegMove({ tripId, routeId, from, to, minutes, mode, chosen, tripMode, walkable, planeable, flight, locked = false }: Props) {
  const leg = useChangeLegMode({ tripId, routeId, from, to, saved: mode, tripMode, chosen, planeable, hasFlight: Boolean(flight?.flight) })
  const label = (
    <>
      <Icon name={ICONS[leg.value]} size={16} />
      <span>
        {translate(`${LEG_MODE_LABELS[leg.value]}で約 ${durationLabel(minutes)}`, `${LEG_MODE_LABELS[leg.value]} · about ${durationLabel(minutes)}`)}
      </span>
      {chosen && <span className={styles.only}>{translate('この区間だけ', "This leg only")}</span>}
    </>
  )
  const view = flightView(mode, leg.value, flight)
  // 時刻表の出典。便か最終便を出すときだけ、この 1 行だけを出す（Takana の決定、2026-11-22）
  const source = <p className={styles.notice}>{translate('時刻表：公共交通オープンデータセンター', 'Timetable: Public Transportation Open Data Center')}</p>
  const flightInfo =
    view?.kind === 'flight' ? (
      <div className={styles.flight}>
        <p className={styles.flightLine}>
          {view.run.airline} {view.run.numbers[0]}　{view.run.from.name} {view.run.dep} → {view.run.to.name} {view.run.arr}
        </p>
        {source}
      </div>
    ) : view?.kind === 'lastFlight' ? (
      // 乗れる便がないときは、その日の最終便と次の手を案内する（かめの決定、2026-11-18、#446）
      <div className={styles.flight}>
        <p className={styles.flightLine}>
          {translate(
            `この区間の最終便は ${view.last.airline} ${view.last.number}（${view.last.from.name} ${view.last.dep} 発）です。${view.last.arriveAirportBy} までに空港に着くか、翌日の便にしてください。`,
            `The last flight is ${view.last.airline} ${view.last.number} from ${view.last.from.name} at ${view.last.dep}. Reach the airport by ${view.last.arriveAirportBy} or take a flight the next day.`,
          )}
        </p>
        <p className={styles.notice}>
          {translate('今は距離から見積もった目安で組んでいます。出発を早めると、乗れる便を探し直します。', 'The current time is estimated from the distance. Leave earlier to check for another flight.')}
        </p>
        {source}
      </div>
    ) : view?.kind === 'estimate' ? (
      // 便も最終便も分からない（時刻表がない、直行便がない）とき。便は、しおりを組み直すたびに探し直す（#482）
      <p className={styles.notice}>{translate('乗れる便が見つからなかったので、距離から見積もった目安です。', "No suitable flight was found. The time is estimated from the distance.")}</p>
    ) : view?.kind === 'unsearched' ? (
      // まだ便を探していない（便を最初から探すようにする前に作ったしおり。次に組み直すと便を探す。#482）
      <p className={styles.notice}>{translate('距離から見積もった目安です。「飛行機」を選ぶと、時刻表から便を探します。', "Estimated from the distance. Choose Flight to check the schedule.")}</p>
    ) : null
  return (
    <div className={styles.wrap}>
      {locked ? (
        <p className={styles.move}>{label}</p>
      ) : (
      <button
        type="button"
        className={`${styles.move} ${styles.button}`}
        aria-expanded={leg.open}
        aria-label={translate(`次の場所まで、${LEG_MODE_LABELS[leg.value]}で約 ${durationLabel(minutes)}。押すと、この区間の移動手段を選び直せます`, `To the next stop: ${LEG_MODE_LABELS[leg.value]}, about ${durationLabel(minutes)}. Change travel mode for this leg.`)}
        disabled={leg.busy}
        onClick={leg.toggle}
      >
        {label}
        <Icon name="chevron" size={14} />
      </button>
      )}
      {flightInfo}
      {leg.open && !locked && (
        <div className={styles.choices} role="radiogroup" aria-label={translate('この区間の移動手段', "Travel mode for this leg")}>
          {leg.options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === leg.value}
              className={option === leg.value ? `${styles.choice} ${styles.selected}` : styles.choice}
              disabled={option === 'walk' && !walkable}
              onClick={() => void leg.choose(option)}
            >
              <Icon name={ICONS[option]} size={16} />
              {LEG_MODE_LABELS[option]}
            </button>
          ))}
          {!walkable && <span className={styles.note}>{translate('10 km より遠いので、徒歩は選べません', "Walking is unavailable for legs longer than 10 km.")}</span>}
        </div>
      )}
    </div>
  )
}
