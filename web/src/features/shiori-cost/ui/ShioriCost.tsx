import type { Pin } from '@/entities/pin'
import type { Route } from '@/entities/route'
import type { Trip } from '@/entities/trip'
import type { WithId } from '@/shared/api'
import { translate } from '@/shared/lib'
import type { YenRange } from '../model/estimate'
import { routeCost } from '../model/routeCost'
import styles from './ShioriCost.module.css'

interface Props {
  trip: Trip
  route: Route
  pins: readonly WithId<Pin>[]
  memberCount: number
}

const formatYen = new Intl.NumberFormat(translate('ja-JP', 'en-US'))

function yen([low, high]: YenRange): string {
  if (low === high) return translate(`${formatYen.format(low)} 円`, `¥${formatYen.format(low)}`)
  return translate(`${formatYen.format(low)}〜${formatYen.format(high)} 円`, `¥${formatYen.format(low)}–¥${formatYen.format(high)}`)
}

export function ShioriCost({ trip, route, pins, memberCount }: Props) {
  const { transport, meals, total, missingLegs, transportKnown } = routeCost(trip, route, pins, memberCount)
  return (
    <section className={styles.cost} aria-label={translate('料金の目安', 'Estimated cost')}>
      <h3>{translate('料金の目安（1人あたり）', 'Estimated cost (per person)')}</h3>
      <dl>
        <div><dt>{translate('交通費', 'Transport')}</dt><dd>{transportKnown ? yen(transport) : translate('算出できません', "Can't be estimated")}</dd></div>
        <div><dt>{translate('食費', 'Meals')}</dt><dd>{yen(meals)}</dd></div>
        <div><dt>{missingLegs > 0 ? translate('分かる分の合計', 'Known total') : translate('合計', 'Total')}</dt><dd>{yen(total)}</dd></div>
      </dl>
      {missingLegs > 0 && (
        <p>
          {translate(
            `${missingLegs} 区間の交通費は距離が分からないため、合計に含みません。`,
            `Transport for ${missingLegs} ${missingLegs === 1 ? 'leg is' : 'legs is'} not included because the distance is unknown.`,
          )}
        </p>
      )}
      <details>
        <summary>{translate('見積もりの内訳と前提', 'How this is estimated')}</summary>
        <p>{translate('交通費は、出発地から帰るまでの区間ごとの距離から計算します。車は燃料代を参加人数で割ります。食費は日数分の昼食と泊数分の夕食です。', 'Transport is calculated from the distance of each leg, from departure until you return. For cars, fuel is split among the members. Meals cover one lunch per day and one dinner per night.')}</p>
        <p>{translate('宿泊費、通行料、駐車料は別です。実際の運賃や代金は予約先などで確認してください。', 'Lodging, tolls and parking are not included. Check actual fares and prices with the provider.')}</p>
      </details>
    </section>
  )
}
