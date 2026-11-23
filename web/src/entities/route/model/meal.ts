import { translate } from '../../../shared/lib/language.ts'
import type { Route, RouteStop } from './types'

// しおりのごはんの枠の決め（企画書「ユーザー体験」3-7 の 8。#522）。Functions 側は functions/src/domain/meal.ts。片方を変えたら、もう片方も合わせる

/** 1 日のごはん。朝・昼・晩の順 */
export const MEAL_KINDS = ['breakfast', 'lunch', 'dinner'] as const
export type MealKind = (typeof MEAL_KINDS)[number]

/** 日本語の呼び方。希望の文（Firestore に残る共有のデータ）にも使うので、言語を切り替えない */
const MEAL_LABELS_JA: Record<MealKind, string> = { breakfast: '朝ごはん', lunch: '昼ごはん', dinner: '晩ごはん' }
const MEAL_LABELS_EN: Record<MealKind, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

/** 画面での呼び方（選んだ言語） */
export const MEAL_LABELS: Record<MealKind, string> = translate(MEAL_LABELS_JA, MEAL_LABELS_EN)

/** 希望の文に使う、日本語の呼び方（言語を切り替えない） */
export const MEAL_WISH_LABELS: Readonly<Record<MealKind, string>> = MEAL_LABELS_JA

/** 「1 日目の昼ごはん」を画面の言語で */
export function mealDayLabel(day: number, meal: MealKind): string {
  return translate(`${day} 日目の${MEAL_LABELS_JA[meal]}`, `Day ${day} ${MEAL_LABELS_EN[meal].toLowerCase()}`)
}

/** 希望の mealSlot（「1-lunch」）から、画面の言語の呼び方。読めなければ null */
export function mealSlotLabel(slot: string): string | null {
  const match = /^(\d+)-(breakfast|lunch|dinner)$/.exec(slot)
  return match ? mealDayLabel(Number(match[1]), match[2] as MealKind) : null
}

/** Route.meals の値で、その枠はお店を建てずに決めたことを表す印。書いた言葉があれば「@skip:コンビニ」の形 */
export const MEAL_SKIP = '@skip'

/** 自分で書ける言葉の長さの上限（Functions の MEAL_NOTE_MAX と合わせる） */
export const MEAL_NOTE_MAX = 20

/** 枠のキー（Route.meals のキー、希望の mealSlot）。「1-lunch」の形 */
export const mealKey = (day: number, meal: MealKind) => `${day}-${meal}`

function isSkip(value: string | undefined): value is string {
  return value === MEAL_SKIP || (typeof value === 'string' && value.startsWith(`${MEAL_SKIP}:`))
}

/**
 * ごはんの枠 1 つの状態。open：まだ決めていない（点線の枠）。skip：お店を建てずに決めた（note は書いた言葉。なければ null）。
 * pin：お店が建物で決まっている（pinId。しおりの行として出る）
 */
export type MealState = { day: number; meal: MealKind; key: string } & ({ state: 'open' } | { state: 'skip'; note: string | null } | { state: 'pin'; pinId: string })

/**
 * 日ごとの朝・昼・晩ごはんの枠（1 日目の朝から順）。days は旅の日数。
 * お店のピンがしおりの行にないもの（消えた、まだ届いていない）は、決めていない枠として出す
 */
export function mealSlots(route: Pick<Route, 'meals' | 'schedule'>, days: number): MealState[] {
  const result: MealState[] = []
  for (let day = 1; day <= days; day += 1) {
    for (const meal of MEAL_KINDS) {
      const key = mealKey(day, meal)
      const value = route.meals?.[key]
      if (isSkip(value)) result.push({ day, meal, key, state: 'skip', note: value.slice(MEAL_SKIP.length + 1) || null })
      else if (value && route.schedule.some((stop) => stop.pinId !== null && (stop.stopId ?? stop.pinId) === value)) result.push({ day, meal, key, state: 'pin', pinId: value })
      else result.push({ day, meal, key, state: 'open' })
    }
  }
  return result
}

/** ごはんに決まったお店の行の ID と、どのごはんか（行の地名の下に「昼ごはん」と出す） */
export function mealStops(route: Pick<Route, 'meals'>): Map<string, MealKind> {
  const result = new Map<string, MealKind>()
  for (const [key, value] of Object.entries(route.meals ?? {})) {
    const meal = key.split('-')[1] as MealKind
    if (!isSkip(value) && (MEAL_KINDS as readonly string[]).includes(meal)) result.set(value, meal)
  }
  return result
}

/** この時刻より前に着く場所のあとに、昼・晩ごはんの枠を出す（Functions がお店を入れる位置と同じ） */
const MEAL_BEFORE: Record<Exclude<MealKind, 'breakfast'>, string> = { lunch: '12:00', dinner: '18:00' }

/**
 * その日の行のうち、ごはんの枠を出す位置。0 はその日の最初の行の前、n は n 行目のあと。
 * 朝は最初の場所の前、昼は 12 時、晩は 18 時より前に着く最後の場所のあと（宿の行の前）。なければ、朝と同じく最初の場所の前。
 * 場所でない行（集合場所の「出発」の行）と宿の行は、場所に数えない。Functions がお店を入れる位置（domain/meal.ts の mealInsertIndex）と同じ数え方。
 * その日に場所がなければ 0
 */
export function mealSlotIndex(stops: readonly Pick<RouteStop, 'time' | 'pinId' | 'stopId'>[], meal: MealKind, stayIds: readonly string[] = []): number {
  const places = stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => stop.pinId !== null && !stayIds.includes(stop.stopId ?? stop.pinId))
  if (places.length === 0) return 0
  const first = places[0].index
  if (meal === 'breakfast') return first
  const limit = MEAL_BEFORE[meal]
  const before = places.filter(({ stop }) => stop.time < limit)
  return before.length > 0 ? before[before.length - 1].index + 1 : first
}

/** ごはんのお店を探す範囲の、真ん中からの広さ（度。南北・東西に約 10 km） */
const SEARCH_LAT = 0.09
const SEARCH_LNG = 0.11

/**
 * その枠のお店を探す範囲。枠を出す位置のすぐ前の場所（なければすぐあとの場所）のまわり。
 * その日に場所がなければ、それより前の最後の場所、それもなければ、しおりの最初の場所のまわり。どれもなければ null（いま地図で映している範囲から探す）
 */
export function mealSearchBounds(
  schedule: readonly Pick<RouteStop, 'day' | 'time' | 'pinId' | 'stopId'>[],
  day: number,
  meal: MealKind,
  locationOf: (pinId: string) => { lat: number; lng: number } | undefined,
  stayIds: readonly string[] = [],
): { north: number; south: number; east: number; west: number } | null {
  const today = schedule.filter((stop) => stop.day === day && stop.pinId)
  const index = mealSlotIndex(today, meal, stayIds)
  const near = [today[index - 1], today[index], ...schedule.filter((stop) => stop.day < day).reverse(), ...schedule]
  const from = near.flatMap((stop) => (stop?.pinId ? (locationOf(stop.pinId) ?? []) : []))[0]
  if (!from) return null
  return { north: from.lat + SEARCH_LAT, south: from.lat - SEARCH_LAT, east: from.lng + SEARCH_LNG, west: from.lng - SEARCH_LNG }
}
