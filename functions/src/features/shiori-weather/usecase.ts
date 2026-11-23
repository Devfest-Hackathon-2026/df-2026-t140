import type { Trip } from '../../domain/trip'
import { assembleForecasts, jstToday, officeCodesOf } from './logic'
import type { ShioriWeatherPorts } from './ports'
import type { ShioriWeatherInput, ShioriWeatherResult } from './types'

/**
 * 旅の予定日の府県の天気を返す。読む（メンバーか、旅の日付）→ 聞く（府県ごと、予報区のコードだけ）→ 絞って返す。何も書かない。
 * メンバーでなければ、気象庁には聞かない。府県ごとに取れなかったものは、その府県だけ出さない（ほかは出す）。
 */
export async function shioriWeather(ports: ShioriWeatherPorts, input: ShioriWeatherInput): Promise<ShioriWeatherResult> {
  const tripRef = ports.db.collection('trips').doc(input.tripId)
  const [tripSnapshot, memberSnapshot] = await Promise.all([tripRef.get(), tripRef.collection('members').doc(input.uid).get()])
  if (!memberSnapshot.exists) return { status: 'not-member' }
  const trip = tripSnapshot.data() as Trip | undefined
  if (!trip) return { status: 'not-found' }

  const today = jstToday(input.now)
  if ((trip.endDate ?? trip.startDate) < today || trip.startDate > jstToday(input.now + 7 * 86_400_000)) {
    return { status: 'ok', forecasts: [] }
  }
  const prefectures = [...new Set(input.prefectures)]
  const codes = [...new Set(prefectures.flatMap(officeCodesOf))]
  const reports = new Map<string, unknown>()
  await Promise.all(
    codes.map(async (code) => {
      try {
        const json = await ports.jma.fetchOffice(code)
        if (json !== null && json !== undefined) reports.set(code, json)
      } catch {
        // この予報区だけ抜く。ほかの府県は出す
      }
    }),
  )

  const forecasts = assembleForecasts({
    prefectures,
    reports,
    startDate: trip.startDate,
    endDate: trip.endDate ?? null,
    today,
  })
  return { status: 'ok', forecasts }
}
