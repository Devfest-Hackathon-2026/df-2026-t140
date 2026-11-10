import type { PinCategory } from '../../domain/pin'
import { MIN_PLACES_FOR_ROUTES, MIN_PLACES_FOR_SHIORI, type Route, type RouteStyle, SHIORI_ROUTE_ID } from '../../domain/route'
import {
  buildPlan,
  insertionIndex,
  type PlanOrigin,
  type PlanPlace,
  proposeOrders,
  STYLE_LABELS,
  STYLE_ORDER,
  STYLE_TIMINGS,
} from '../../domain/routePlan'
import type { GeminiResult } from '../../ports/gemini'
import type { ProposedOption, ProposeRoutesInput, ProposeRoutesOutput } from './types'

// ルート案を作る純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** トリガーが見るピンの変化か。「完成」になった瞬間だけ（ほかの更新では動かない） */
export function becameDone(before: { status?: string } | undefined, after: { status?: string } | undefined): boolean {
  return after?.status === 'done' && before?.status !== 'done'
}

/** ルート案を出せる数の場所が建っているか */
export function enoughPlaces(count: number): boolean {
  return count >= MIN_PLACES_FOR_ROUTES
}

/** しおりのルートを作れる数の場所が建っているか（1 つ建てば作る） */
export function enoughPlacesForShiori(count: number): boolean {
  return count >= MIN_PLACES_FOR_SHIORI
}

/** 場所の組み合わせを表す文字。同じ場所で作った案がもうあるかを見分けるのに使う（順番は関係ない） */
export function placesKey(pinIds: readonly string[]): string {
  return [...pinIds].sort().join('|')
}

/** キャッチコピーに使う、場所の種類の言葉 */
const CATEGORY_WORDS: Record<PinCategory, string> = {
  onsen: '湯けむり',
  ski: '雪山',
  food: 'ごちそう',
  farm: '畑のめぐみ',
  nightview: '夜景',
  nature: '絶景',
  shrine: '歴史',
  themepark: 'あそび',
  town: '街歩き',
}

const STYLE_ENDINGS: Record<RouteStyle, string> = {
  shortest: 'さくっとめぐる旅',
  relaxed: 'ゆったり味わう旅',
  wishes: 'みんなの希望からはじめる旅',
}

/** 固定の応答のキャッチコピー。回る順に、場所の種類の言葉を 2 つまで並べる（「湯けむりと雪山、さくっとめぐる旅」） */
export function stubCatchphrase(categories: readonly PinCategory[], style: RouteStyle): string {
  const words = [...new Set(categories.map((category) => CATEGORY_WORDS[category] ?? CATEGORY_WORDS.town))].slice(0, 2)
  return `${words.join('と')}、${STYLE_ENDINGS[style]}`
}

/** 固定の応答：自分たちの計算で 3 案を作る（本物の Gemini ではない） */
export function stubOptions(input: ProposeRoutesInput): ProposeRoutesOutput {
  const orders = proposeOrders(input.places, input.origin)
  const categoryOf = new Map(input.places.map((place) => [place.id, place.category]))
  return {
    options: STYLE_ORDER.map((style) => {
      const pinIds = orders[style].map((place) => place.id)
      return { style, pinIds, catchphrase: stubCatchphrase(pinIds.map((id) => categoryOf.get(id) ?? 'town'), style) }
    }),
  }
}

const MAX_CATCHPHRASE = 40

/** 応答が決めた形かを確かめる。違えば例外を投げる（3 案、種類は 1 つずつ、文字数） */
export function parseOptions(json: unknown): ProposeRoutesOutput {
  const options = (json as { options?: unknown })?.options
  if (!Array.isArray(options) || options.length !== STYLE_ORDER.length) throw new Error('options は 3 つ要ります')
  const parsed = options.map((option): ProposedOption => {
    const { style, catchphrase, pinIds } = (option ?? {}) as Record<string, unknown>
    if (typeof style !== 'string' || !(STYLE_ORDER as readonly string[]).includes(style)) throw new Error('style が違います')
    if (typeof catchphrase !== 'string' || catchphrase.trim().length === 0) throw new Error('catchphrase がありません')
    if (!Array.isArray(pinIds) || !pinIds.every((id) => typeof id === 'string')) throw new Error('pinIds が違います')
    return { style: style as RouteStyle, catchphrase: Array.from(catchphrase.trim()).slice(0, MAX_CATCHPHRASE).join(''), pinIds }
  })
  if (new Set(parsed.map((option) => option.style)).size !== STYLE_ORDER.length) throw new Error('style が重なっています')
  return { options: parsed }
}

/** 応答の順番が、入力の場所をすべて 1 回ずつ回っているか */
function coversPlaces(options: readonly ProposedOption[], input: ProposeRoutesInput): boolean {
  const key = placesKey(input.places.map((place) => place.id))
  return options.every((option) => option.pinIds.length === input.places.length && placesKey(option.pinIds) === key)
}

/**
 * Gemini の呼び出し口の結果から、採用する 3 案を決める。
 * 形が違う、場所が抜けている・余っている、のどれかなら、自分たちの計算（固定の応答）に差し替える。
 */
export function chooseOptions(
  result: GeminiResult<unknown>,
  input: ProposeRoutesInput,
): { options: ProposedOption[]; proposedBy: Route['proposedBy'] } {
  try {
    const { options } = parseOptions(result.output)
    if (coversPlaces(options, input)) return { options, proposedBy: result.provider }
  } catch {
    // 下で差し替える
  }
  return { options: stubOptions(input).options, proposedBy: 'stub' }
}

/** 保存するルート案（時刻を除く）。ID は「g＋世代＋案」。作り直すと ID も変わるので、前の案への票が残らない */
export type RouteDraft = Omit<Route, 'createdAt' | 'updatedAt'> & { id: string }

/** 採用した 3 案に、スケジュールと移動の合計を付けて、保存する形にする。案は A、B、C の順 */
export function draftRoutes(
  options: readonly ProposedOption[],
  input: ProposeRoutesInput,
  proposedBy: Route['proposedBy'],
  generation: number,
): RouteDraft[] {
  const placeOf = new Map(input.places.map((place) => [place.id, place]))
  return STYLE_ORDER.flatMap((style) => {
    const option = options.find((item) => item.style === style)
    if (!option) return []
    const order = option.pinIds.flatMap((id) => placeOf.get(id) ?? [])
    const plan = buildPlan(order, input.origin, input.days, STYLE_TIMINGS[style])
    const label = STYLE_LABELS[style]
    return [
      {
        id: `g${generation}-${label.toLowerCase()}`,
        label,
        style,
        catchphrase: option.catchphrase,
        pinIds: option.pinIds,
        ...plan,
        proposedBy,
        generation,
        revision: 0,
        addedPinIds: [],
      },
    ]
  })
}

/**
 * しおりのルート（1 本）を、採用した案のうち「移動が短い」案から作る。ID は SHIORI_ROUTE_ID で固定。
 * このあと建った場所は、addToDecidedRoute で順番を保ったまま足す（作り直さない）。
 */
export function draftShiori(
  options: readonly ProposedOption[],
  input: ProposeRoutesInput,
  proposedBy: Route['proposedBy'],
): RouteDraft | null {
  const [draft] = draftRoutes(
    options.filter((option) => option.style === 'shortest'),
    input,
    proposedBy,
    1,
  )
  return draft ? { ...draft, id: SHIORI_ROUTE_ID } : null
}

/** 決まったルートを組み直した結果。変わる項目だけ */
export type RouteUpdate = Pick<
  Route,
  'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'addedPinIds'
>

/**
 * 決まったあとに建った場所を、決まったルートに足す。
 * - 足す位置は、移動がいちばん増えない所（domain/routePlan.ts の insertionIndex）。ほかの場所の順番は変えない
 * - スケジュールは、その案の時間の決め（滞在、出発の時刻）のまま計算し直す
 * - まだルートに入っていない、建った場所だけを足す。足すものがなければ null（同じイベントが 2 回来ても変わらない）
 * places は、建った場所のすべて（建った順）。
 */
export function addToDecidedRoute(
  route: Pick<Route, 'style' | 'pinIds' | 'revision' | 'addedPinIds'>,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
): RouteUpdate | null {
  const placeOf = new Map(places.map((place) => [place.id, place]))
  const order = route.pinIds.flatMap((id) => placeOf.get(id) ?? [])
  const missing = places.filter((place) => !route.pinIds.includes(place.id))
  if (missing.length === 0) return null
  for (const place of missing) order.splice(insertionIndex(order, place, origin), 0, place)
  return {
    pinIds: order.map((place) => place.id),
    ...buildPlan(order, origin, days, STYLE_TIMINGS[route.style] ?? STYLE_TIMINGS.shortest),
    revision: (route.revision ?? 0) + 1,
    addedPinIds: [...(route.addedPinIds ?? []), ...missing.map((place) => place.id)],
  }
}
