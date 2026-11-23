// しおりのごはんの枠（企画書「ユーザー体験」3-7 の 8。#522）。純粋。scripts/meal.test.mjs で確かめる。
// 画面側の同じ決めは web/src/entities/route/model/meal.ts。片方を変えたら、もう片方も合わせる
import type { Route, RouteStop } from './route'

/** 1 日のごはん。朝・昼・晩 */
export const MEAL_KINDS = ['breakfast', 'lunch', 'dinner'] as const
export type MealKind = (typeof MEAL_KINDS)[number]

/** 枠のキーで受け取る日の上限（firestore.rules と合わせる） */
export const MEAL_DAY_MAX = 31

/** Route.meals の値で、その枠はお店を建てずに決めた（「なし」「コンビニ」など）ことを表す印。書いた言葉があれば「@skip:コンビニ」の形 */
export const MEAL_SKIP = '@skip'

/** 自分で書ける言葉の長さの上限 */
export const MEAL_NOTE_MAX = 20

/** 枠のキー（Route.meals のキー、希望とピンの mealSlot）。「1-lunch」の形 */
export function mealKey(day: number, meal: MealKind): string {
  return `${day}-${meal}`
}

/** 枠のキーを日と食事に分ける。決まった形（1 〜 MEAL_DAY_MAX の日と、朝・昼・晩のどれか）でなければ null */
export function parseMealKey(key: unknown): { day: number; meal: MealKind } | null {
  if (typeof key !== 'string') return null
  const match = /^([1-9]\d?)-(breakfast|lunch|dinner)$/.exec(key)
  if (!match) return null
  const day = Number(match[1])
  return day <= MEAL_DAY_MAX ? { day, meal: match[2] as MealKind } : null
}

/** Route.meals の値が、お店を建てずに決めた印か */
export function isMealSkip(value: string | undefined): boolean {
  return value === MEAL_SKIP || (typeof value === 'string' && value.startsWith(`${MEAL_SKIP}:`))
}

/** お店を建てずに決めた印。note があれば「@skip:コンビニ」、なければ「@skip」 */
export function mealSkipValue(note: string | null | undefined): string {
  const text = (note ?? '').trim().slice(0, MEAL_NOTE_MAX)
  return text ? `${MEAL_SKIP}:${text}` : MEAL_SKIP
}

/** この時刻より前に着く場所のあとに、昼・晩ごはんを入れる */
const MEAL_BEFORE: Record<Exclude<MealKind, 'breakfast'>, string> = { lunch: '12:00', dinner: '18:00' }

/**
 * 建ったお店を、回る順番のどこに入れるか（order の位置）。いまのしおりの時刻（schedule）を見て決める。
 * - 朝：その日の最初の場所の前（前の夜の宿のあと）
 * - 昼：その日に 12 時より前に着く最後の場所のあと。なければ、その日の最初の場所の前
 * - 晩：その日に 18 時より前に着く最後の場所のあと（宿の行の前）。なければ、その日の最初の場所の前
 * - その日に場所がなければ、それより前の日の最後の場所のあと（なければ先頭）
 * 宿の行（stayIds）は、その日の場所に数えない
 */
export function mealInsertIndex(
  order: readonly { id: string }[],
  schedule: readonly Pick<RouteStop, 'day' | 'time' | 'pinId' | 'stopId'>[],
  slot: { day: number; meal: MealKind },
  stayIds: readonly string[] = [],
): number {
  const placed = schedule.flatMap((stop) => {
    const id = stop.stopId ?? stop.pinId
    const index = id ? order.findIndex((place) => place.id === id) : -1
    return index >= 0 ? [{ day: stop.day, time: stop.time, index, stay: stayIds.includes(id!) }] : []
  })
  const today = placed.filter((stop) => stop.day === slot.day && !stop.stay)
  if (today.length > 0) {
    if (slot.meal === 'breakfast') return today[0].index
    const limit = MEAL_BEFORE[slot.meal]
    const before = today.filter((stop) => stop.time < limit)
    return before.length > 0 ? before[before.length - 1].index + 1 : today[0].index
  }
  const earlier = placed.filter((stop) => stop.day < slot.day)
  return earlier.length > 0 ? Math.max(...earlier.map((stop) => stop.index)) + 1 : 0
}

/** 建ったお店を入れた結果。meals は入れたあとの Route.meals */
export function assignMeal<T extends { id: string; meal?: string }>(
  order: readonly T[],
  place: T,
  route: Partial<Pick<Route, 'schedule' | 'meals' | 'pinIds'>>,
  meals: Readonly<Record<string, string>> | undefined,
  stayIds: readonly string[],
): { order: T[]; meals: Record<string, string> } | null {
  const slot = parseMealKey(place.meal)
  if (!slot) return null
  const key = mealKey(slot.day, slot.meal)
  const now = meals?.[key]
  // その枠に、まだしおりにあるお店が決まっていれば、ふつうの場所として足す（呼ぶ側）
  if (now !== undefined && !isMealSkip(now) && order.some((item) => item.id === now)) return null
  const index = mealInsertIndex(order, route.schedule ?? [], slot, stayIds)
  return { order: [...order.slice(0, index), place, ...order.slice(index)], meals: { ...(meals ?? {}), [key]: place.id } }
}

/**
 * 枠を、お店を建てずに決める（skip が true。note は書いた言葉）か、点線の枠に戻す（false）。行程は変わらない。
 * - 日が旅の日程にない（1 〜 days でない）か、キーの形が違えば 'invalid'
 * - その枠のお店が、もう建物で決まっていて、しおりにあれば 'decided'（外すには、その建物を消す）
 * - もうその形なら 'unchanged'
 */
export function mealsAfterSkip(
  route: Pick<Route, 'meals' | 'revision' | 'pinIds'>,
  days: number,
  key: string,
  skip: boolean,
  note?: string | null,
): Pick<Route, 'meals' | 'revision'> | 'invalid' | 'decided' | 'unchanged' {
  const slot = parseMealKey(key)
  if (!slot || slot.day > days) return 'invalid'
  const now = route.meals?.[key]
  if (now !== undefined && !isMealSkip(now) && route.pinIds.includes(now)) return 'decided'
  const next = skip ? mealSkipValue(note) : undefined
  if (now === next) return 'unchanged'
  const meals = { ...(route.meals ?? {}) }
  if (next) meals[key] = next
  else delete meals[key]
  return { meals, revision: (route.revision ?? 0) + 1 }
}
