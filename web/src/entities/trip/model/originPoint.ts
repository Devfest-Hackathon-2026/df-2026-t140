import { translate as t } from '../../../shared/lib/language.ts'
import { originLocation } from './originPlaces'

export interface OriginPoint {
  name: string
  location: { lat: number; lng: number }
  placeId: string | null
}

export function tripOriginLocation(trip: { origin: string; originPoint?: OriginPoint }) {
  const point = trip.originPoint
  return point?.name === trip.origin && Number.isFinite(point.location?.lat) && Number.isFinite(point.location?.lng)
    && Math.abs(point.location.lat) <= 90 && Math.abs(point.location.lng) <= 180
    ? point.location : originLocation(trip.origin)
}

export function originProblem(status: string): string {
  if (status === 'conflict') return t('ほかの人が出発地を変えました。「やめる」を押して、変更画面を開き直してください。', 'Someone else changed the departure point. Cancel and reopen the edit form.')
  if (status === 'unavailable') return t('この出発地はまだ検索できません。駅名を入れるか、ホームでAIの合言葉を確認してください。', 'This departure point cannot be searched yet. Enter a station name or check the AI passphrase on the home screen.')
  return t('出発地が見つかりませんでした。駅名や市区町村を加えて、もう一度試してください。', 'Could not find the departure point. Add a station or city name and try again.')
}
