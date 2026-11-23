import { dropToFit, measureTrip, OVER_ALLOWANCE_MINUTES } from '../../domain/dropToFit'
import { eventWindow } from '../../domain/event'
import { fitToDays } from '../../domain/fitDays'
import { parseMealKey } from '../../domain/meal'
import { refill } from '../../domain/placeBack'
import type { Route } from '../../domain/route'
import { buildPlan, type FlightChoices, type PlanOrigin, type PlanPlace, routeTiming, settleEvents } from '../../domain/routePlan'
import { pinOfStop, visitOrder } from '../../domain/visit'

// 旅の日程を変えるときの、純粋な判断と計算。SDK を使わないので、Emulator なしで試せる（scripts/edit-trip-dates.test.mjs）

/** 旅の日数の上限（泊まる夜の数の上限 30 に合わせる。Pin.lodgingNight と同じ。実装した AI が仮に選んだ） */
export const MAX_TRIP_DAYS = 31

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 日付（YYYY-MM-DD）として正しいか。2026-02-30 のような、ない日は通さない */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * 新しい日程の形を確かめる。帰る日は、なし（日帰り）か行く日より後。行く日と同じ日は日帰りとして null にそろえる。
 * 形がおかしければ null
 */
export function normalizeDates(startDate: unknown, endDate: unknown): { startDate: string; endDate: string | null } | null {
  if (!isCalendarDate(startDate)) return null
  if (endDate === null || endDate === undefined || endDate === startDate) return { startDate, endDate: null }
  if (!isCalendarDate(endDate) || endDate < startDate) return null
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1
  return days <= MAX_TRIP_DAYS ? { startDate, endDate } : null
}

export type ChangeDatesDecision = 'change' | 'unchanged' | 'not-member' | 'not-found' | 'not-owner' | 'confirmed'

/** 日程を変えるかを決める。変えられるのは発案者だけで、旅程が確定しているあいだは発案者も変えられない */
export function decideChangeDates(facts: {
  isMember: boolean
  isOwner: boolean
  tripExists: boolean
  confirmed: boolean
  same: boolean
}): ChangeDatesDecision {
  if (!facts.isMember) return 'not-member'
  if (!facts.tripExists) return 'not-found'
  if (!facts.isOwner) return 'not-owner'
  if (facts.confirmed) return 'confirmed'
  if (facts.same) return 'unchanged'
  return 'change'
}

/**
 * 1 本のルートを、新しい日程で組み直す。区間ごとの手段、人が直した時刻はそのまま。回る順番は、なるべく今のまま。
 * 1. 新しい日程にない夜の宿と、開催日が日程の外になったイベントを外す（domain/fitDays.ts の fitToDays）
 * 2. trim（日数が減った）で、19 時を越えた分の合計が許す幅を越えるなら、外す数がいちばん少なくなるよう場所を外す（domain/dropToFit.ts。#622 と同じ決め）
 * 3. 2 で外した場所と、前に外した場所（leftOutPinIds）を、時間に収まる範囲で入れ直す（domain/placeBack.ts の refill）。
 *    入れる位置は、19 時を越える分 → 移動 がいちばん少ない位置なので、ゆとりのある日（宿の前の日など）にも入る。
 *    日程を延ばしたとき・日付を動かしたときも、前に外した場所が収まれば戻る（バグ30。Takana の決定、2026-11-23）
 * 外したままの場所は leftOutPinIds に残す。origin.startDate は新しい開始日。flights は便を探し直すための時刻表（なければ残してある便）
 */
export function routeWithDates(
  route: Pick<Route, 'style' | 'pinIds' | 'revision' | 'addedPinIds' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging' | 'leftOutPinIds'> & Partial<Pick<Route, 'meals'>>,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  trim: boolean,
  flights?: FlightChoices,
) {
  const timing = routeTiming(route)
  const flightChoices = flights ?? { saved: route.legFlights }
  // 1. 日程の外になった夜の宿とイベントだけを外す（外すかを決めるときも、保存するしおりと同じ便で組む）
  const fit = fitToDays(visitOrder(route.pinIds, places), origin, days, timing, false, route.legModes, flightChoices)
  // 時間に収まるかの物差しは、人が直した時刻を使わない（propose-routes の fitMeasure と同じ。人が直した時刻のせいで場所が外れないように）
  const { stopTimes: _stopTimes, lodging: _lodging, ...plain } = timing
  const measure = (lodging: Record<string, string> | undefined) => measureTrip(origin, days, lodging ? { ...plain, lodging } : plain, route.legModes)
  let order = fit.order
  // 2. 縮めて時間に収まらなければ、外す数がいちばん少なくなるよう外す
  let dropped: string[] = []
  if (trim) {
    const result = dropToFit(order, origin, measure(fit.lodging))
    order = result.order
    dropped = result.leftOut
  }
  // 入れ直してよい越えの上限。許す幅か、今もう越えている分（人が行を増やしたなど）。入れ直してこれより増やさない
  const target = Math.max(OVER_ALLOWANCE_MINUTES, measure(fit.lodging)(order).over)
  // 3. 外した場所を入れ直す。いま外した場所（残したい順の高いほうから）、前に外した場所（外した順）の順に試す。
  // 1 で外した場所（日程の外の夜の宿、日程の外のイベント）は入れ直さない
  const placeOf = new Map(places.map((place) => [place.id, place]))
  const inOrder = new Set(order.map((place) => pinOfStop(place.id)))
  const candidates = [...[...dropped].reverse(), ...(route.leftOutPinIds ?? [])]
    .filter((id, index, all) => all.indexOf(id) === index && !inOrder.has(id) && !fit.leftOut.includes(id))
    .flatMap((id) => placeOf.get(id) ?? [])
    .filter((place) => !place.event || !origin.startDate || eventWindow(place.event, origin.startDate, days))
  const mealsBefore = route.meals ? mealsWithin(route.meals, days, [...fit.leftOut, ...dropped]) : undefined
  const refilled = refill({ order, lodging: fit.lodging, meals: mealsBefore }, candidates, { origin, days, timing, legModes: route.legModes, measure }, target)
  const restored = new Set(refilled.restored)
  const previous = (route.leftOutPinIds ?? []).filter((id) => !restored.has(id) && !inOrder.has(id))
  const leftOut = [...previous, ...[...fit.leftOut, ...dropped].filter((id) => !restored.has(id) && !previous.includes(id))]
  const { lodging: _saved, ...rest } = timing
  const finalTiming = refilled.lodging ? { ...rest, lodging: refilled.lodging } : rest
  // イベントがあれば、入れ直したあとの順を、イベントを守る形に直す（propose-routes の addToDecidedRoute と同じ）
  const arranged = restored.size > 0 || dropped.length > 0 ? settleEvents(refilled.order, origin, days, finalTiming, route.legModes) : refilled.order
  return {
    // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
    ...buildPlan(arranged, origin, days, finalTiming, undefined, route.legModes, flightChoices),
    revision: (route.revision ?? 0) + 1,
    addedPinIds: (route.addedPinIds ?? []).filter((id) => !leftOut.includes(id)),
    ...(leftOut.length > 0 || route.leftOutPinIds ? { leftOutPinIds: leftOut } : {}),
    ...(refilled.meals ? { meals: mealsWithin(refilled.meals, days, leftOut) } : {}),
  }
}

/**
 * ごはんの枠（Route.meals）のうち、新しい日程に残る枠だけ。日数を越える日の枠と、しおりから外したお店を指す枠は消す
 * （延ばしたときに、前の日程の古い枠がまた出ないように。消した枠は、まだ決めていない枠として点線で出る）
 */
export function mealsWithin(meals: Readonly<Record<string, string>>, days: number, leftOut: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(meals).filter(([key, value]) => {
      const slot = parseMealKey(key)
      return slot !== null && slot.day <= days && !leftOut.includes(value)
    }),
  )
}
