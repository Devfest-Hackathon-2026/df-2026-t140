import { assignMeal, parseMealKey } from '../../domain/meal'
import type { PinCategory } from '../../domain/pin'
import { isLodgingSkip, MIN_PLACES_FOR_ROUTES, MIN_PLACES_FOR_SHIORI, type Route, type RouteStyle, SHIORI_ROUTE_ID } from '../../domain/route'
import {
  assignLodging,
  buildPlan,
  dayPacker,
  eventAwareIndex,
  type FlightChoices,
  type PlanOrigin,
  type PlanPlace,
  proposeOrders,
  STYLE_LABELS,
  STYLE_ORDER,
  routeTiming,
  settleEvents,
  stayMinutesFor,
  STYLE_TIMINGS,
  type StyleTiming,
} from '../../domain/routePlan'
import { pinOfStop, visitOrder } from '../../domain/visit'
import { dropToFit, groupReach, isFixedPlace, measureTrip, OVER_ALLOWANCE_MINUTES, placeGroups } from '../../domain/dropToFit'
import type { GeminiResult } from '../../ports/gemini'
import type { ProposedOption, ProposeRoutesInput, ProposeRoutesOutput, RankPlace, RankPlacesInput, RankPlacesOutput } from './types'

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
  lodging: 'お宿',
}

const STYLE_ENDINGS: Record<RouteStyle, string> = {
  shortest: 'さくっとめぐる旅',
  relaxed: 'ゆったり味わう旅',
  wishes: 'みんなの希望からはじめる旅',
}

const CATEGORY_WORDS_EN: Record<PinCategory, string> = {
  onsen: 'Hot springs',
  ski: 'Snowy slopes',
  food: 'Local food',
  farm: 'Farm visits',
  nightview: 'Night views',
  nature: 'Scenic walks',
  shrine: 'Historic sites',
  themepark: 'Theme parks',
  town: 'Town walks',
  lodging: 'Overnight stays',
}

const STYLE_ENDINGS_EN: Record<RouteStyle, string> = {
  shortest: 'Spend less time on the road',
  relaxed: 'Take time to explore',
  wishes: "Put everyone's wishes first",
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
      const categories = pinIds.map((id) => categoryOf.get(id) ?? 'town')
      const highlights = [...new Set(categories.map((category) => CATEGORY_WORDS_EN[category]))].slice(0, 2).join(' and ')
      return {
        style,
        pinIds,
        catchphrase: stubCatchphrase(categories, style),
        catchphraseEn: highlights ? `${highlights}. ${STYLE_ENDINGS_EN[style]}.` : `${STYLE_ENDINGS_EN[style]}.`,
      }
    }),
  }
}

const MAX_CATCHPHRASE = 40
const MAX_EN_CATCHPHRASE = 80

/** 応答が決めた形かを確かめる。違えば例外を投げる（3 案、種類は 1 つずつ、文字数） */
export function parseOptions(json: unknown): ProposeRoutesOutput {
  const options = (json as { options?: unknown })?.options
  if (!Array.isArray(options) || options.length !== STYLE_ORDER.length) throw new Error('options は 3 つ要ります')
  const parsed = options.map((option): ProposedOption => {
    const { style, catchphrase, catchphraseEn, pinIds } = (option ?? {}) as Record<string, unknown>
    if (typeof style !== 'string' || !(STYLE_ORDER as readonly string[]).includes(style)) throw new Error('style が違います')
    if (typeof catchphrase !== 'string' || catchphrase.trim().length === 0) throw new Error('catchphrase がありません')
    if (!Array.isArray(pinIds) || !pinIds.every((id) => typeof id === 'string')) throw new Error('pinIds が違います')
    const english = typeof catchphraseEn === 'string'
      ? Array.from(catchphraseEn.trim()).slice(0, MAX_EN_CATCHPHRASE).join('')
      : ''
    return {
      style: style as RouteStyle,
      catchphrase: Array.from(catchphrase.trim()).slice(0, MAX_CATCHPHRASE).join(''),
      ...(english ? { catchphraseEn: english } : {}),
      pinIds,
    }
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

/**
 * 採用した 3 案に、スケジュールと移動の合計を付けて、保存する形にする。案は A、B、C の順。
 * flights を渡すと、飛行機の区間（遠い区間と島への区間は、選ばなくても飛行機）の便を探し、便の要約（legFlights）も付ける
 * （押さなくても便が出るように。かめの決定、2026-11-20、#482。domain/flightPlanner.ts の searchingFlights）
 */
export function draftRoutes(
  options: readonly ProposedOption[],
  input: ProposeRoutesInput,
  proposedBy: Route['proposedBy'],
  generation: number,
  flights?: FlightChoices,
): RouteDraft[] {
  const placeOf = new Map(input.places.map((place) => [place.id, place]))
  return STYLE_ORDER.flatMap((style) => {
    const option = options.find((item) => item.style === style)
    if (!option) return []
    const proposed = option.pinIds.flatMap((id) => placeOf.get(id) ?? [])
    // 宿は、案の順番から外して、泊まる夜に入れ直す（空いている夜がなければ、案の順番のまま、ふつうの場所として並べる）
    const { order: proposedOrder, lodging } = withLodgings(proposed.filter((place) => !place.lodging), proposed.filter((place) => place.lodging), input.origin, input.days, undefined, proposed, STYLE_TIMINGS[style])
    // 作ったばかりのしおりに区間ごとの選択はない。飛行機の区間があったときだけ、便の要約を残す
    const timing = lodging ? { ...STYLE_TIMINGS[style], lodging } : STYLE_TIMINGS[style]
    // 時刻が決まったイベントに重なる順番は、そのまま使わない（Gemini の順番も、自分たちの計算の順番も。#581）
    const settled = settleEvents(proposedOrder, input.origin, input.days, timing)
    // 時間に収まらなければ、場所を外す（domain/dropToFit.ts。作るときは Gemini を呼ばず、自分たちの計算の順。#622）
    const fitted = dropToFit(settled, input.origin, measureTrip(input.origin, input.days, timing))
    const order = fitted.leftOut.length > 0 ? settleEvents(fitted.order, input.origin, input.days, timing) : settled
    const { legModes: _legModes, legFlights, ...plan } = buildPlan(order, input.origin, input.days, timing, undefined, undefined, flights)
    const label = STYLE_LABELS[style]
    return [
      {
        id: `g${generation}-${label.toLowerCase()}`,
        label,
        style,
        catchphrase: option.catchphrase,
        ...(option.catchphraseEn ? { catchphraseEn: option.catchphraseEn } : {}),
        // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
        ...plan,
        ...(legFlights && Object.keys(legFlights).length > 0 ? { legFlights } : {}),
        proposedBy,
        generation,
        revision: 0,
        addedPinIds: [],
        ...(fitted.leftOut.length > 0 ? { leftOutPinIds: fitted.leftOut } : {}),
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
  flights?: FlightChoices,
): RouteDraft | null {
  const [draft] = draftRoutes(
    options.filter((option) => option.style === 'shortest'),
    input,
    proposedBy,
    1,
    flights,
  )
  return draft ? { ...draft, id: SHIORI_ROUTE_ID } : null
}

/**
 * 建った場所を、今の順番に足す。
 * - ふつうの場所は、移動がいちばん増えない所に入れる（insertionIndex）
 * - 宿（place.lodging）は、泊まる夜の宿にする（domain/routePlan.ts の assignLodging。その夜までの最後の場所のすぐあとに入れる）。
 *   空いている夜がなければ、ふつうの場所と同じに入れる。そのときの位置は、fallback（案の順番）があればその並びのまま、なければ移動がいちばん増えない所
 * lodging は、足したあとの泊まる夜ごとの宿（Route.lodging）。宿を 1 つも扱わなければ、渡されたまま（なければ undefined）
 * timing を渡すと、どの夜の宿にするかを、しおりと同じ時間での日の分け方（domain/routePlan.ts の dayPacker）で決める。
 * 時刻が決まったイベント（#581）がしおりか足す場所にあれば、ふつうの場所の位置は、イベントを守れる位置から選ぶ（eventAwareIndex）
 */
export function withLodgings(
  base: readonly PlanPlace[],
  added: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  saved?: Readonly<Record<string, string>>,
  fallback?: readonly PlanPlace[],
  timing?: StyleTiming,
): { order: PlanPlace[]; lodging: Record<string, string> | undefined } {
  const pack = timing?.stayScale !== undefined ? dayPacker(origin, timing) : undefined
  let order = [...base]
  let lodging = saved ? { ...saved } : undefined
  for (const place of added) {
    const assigned = place.lodging ? assignLodging(order, place, days, lodging, place.lodging.want, pack) : null
    if (assigned) {
      order = assigned.order
      lodging = assigned.lodging
      continue
    }
    // 案の順番で、この場所より前にある場所のうち、いちばん後ろのもののすぐあとに入れる
    const before = fallback ? fallback.slice(0, fallback.indexOf(place)).map((item) => item.id) : null
    const index = before
      ? order.reduce((at, item, position) => (before.includes(item.id) ? position + 1 : at), 0)
      : eventAwareIndex(order, place, origin, days, { ...(timing ?? STYLE_TIMINGS.shortest), ...(lodging ? { lodging } : {}) })
    order.splice(index, 0, place)
  }
  return { order, lodging }
}

/** 決まったルートを組み直した結果。変わる項目だけ */
export type RouteUpdate = Pick<
  Route,
  'pinIds' | 'schedule' | 'totalMoveMinutes' | 'totalDistanceKm' | 'originIncluded' | 'revision' | 'addedPinIds' | 'legModes' | 'legFlights' | 'lodging'
> & Partial<Pick<Route, 'meals' | 'leftOutPinIds'>>

type AddRoute = Pick<Route, 'style' | 'pinIds' | 'revision' | 'addedPinIds' | 'legModes' | 'legFlights' | 'stopTimes' | 'lodging' | 'leftOutPinIds'> &
  Partial<Pick<Route, 'schedule' | 'meals'>>

/** 建った場所を今の順番に入れた結果（外す前）。足す場所がなければ null */
function placeMissing(route: AddRoute, places: readonly PlanPlace[], origin: PlanOrigin, days: number) {
  // 同じ場所を何度も訪れるしおりでも、行の並びを保つ。その場所の 1 つ目の行はピンの ID なので、入っているかは pinIds で分かる（domain/visit.ts）
  const base = visitOrder(route.pinIds, places)
  // しおりから外した場所（leftOutPinIds。日程を縮めたとき、時間に収まらなかったとき）は、足し直さない
  const missing = places.filter((place) => !route.pinIds.includes(place.id) && !route.leftOutPinIds?.includes(place.id))
  if (missing.length === 0) return null
  const { order: lodged, lodging } = withLodgings(base, missing.filter((place) => !place.meal), origin, days, route.lodging, undefined, routeTiming(route))
  // 足す前のしおりが、もう時間を越えている分（人が行を増やした、時刻を直したなど）。外すのは、足してこれより増える分だけ
  const before = fitMeasure(route, route.lodging, origin, days)(base).over
  let order = lodged
  let meals = route.meals
  const stayIds = Object.values(lodging ?? {}).filter((value) => !isLodgingSkip(value))
  for (const place of missing.filter((item) => item.meal)) {
    // 枠の日が今の日程の外（お店を探したあとで日程を短くした）なら、枠に入れず、ふつうの場所として足す
    const slotDay = parseMealKey(place.meal)?.day
    const assigned = slotDay !== undefined && slotDay <= days ? assignMeal(order, place, route, meals, stayIds) : null
    if (assigned) {
      order = assigned.order
      meals = assigned.meals
    } else {
      order = [...order]
      // ふつうの場所と同じく、時刻が決まったイベントを守れる位置に入れる（withLodgings と同じ。#581）
      order.splice(eventAwareIndex(order, place, origin, days, routeTiming({ ...route, lodging })), 0, place)
    }
  }
  return { order, lodging, meals, missing, allowance: Math.max(OVER_ALLOWANCE_MINUTES, before) }
}

/**
 * 時間に収まるかを測る物差し。人が直した時刻（stopTimes）は使わず、自動で組んだ時刻で測る
 * （人が直した時刻のせいで場所が外れないように。外すのは、場所の組み合わせが日程に入りきらないときだけ）
 */
function fitMeasure(route: AddRoute, lodging: Route['lodging'], origin: PlanOrigin, days: number) {
  const { stopTimes: _stopTimes, ...timing } = routeTiming({ ...route, lodging })
  return measureTrip(origin, days, timing, route.legModes)
}

/**
 * 建った場所を足すと時間に収まらなくなるとき、Gemini に残したい順を聞くための入力（#622）。収まるなら、足す場所がなければ null。
 * Gemini はトランザクションの外で呼び、その順を addToDecidedRoute の ranking に渡す
 */
export function rankRequest(route: AddRoute, places: readonly PlanPlace[], origin: PlanOrigin, days: number, tripTitle: string): RankPlacesInput | null {
  const placed = placeMissing(route, places, origin, days)
  if (!placed) return null
  const { over } = fitMeasure(route, placed.lodging, origin, days)(placed.order)
  if (over <= placed.allowance) return null
  const { stopTimes: _stopTimes, ...timing } = routeTiming({ ...route, lodging: placed.lodging })
  return rankInput(placed.order, origin, days, timing, tripTitle, over)
}

/**
 * 決まったあとに建った場所を、決まったルートに足す。
 * - 足す位置は、移動がいちばん増えない所（domain/routePlan.ts の insertionIndex）。ほかの場所の順番は変えない
 * - スケジュールは、その案の時間の決め（滞在、出発の時刻）のまま計算し直す
 * - まだルートに入っていない、建った場所だけを足す（しおりから外した場所は除く）。足すものがなければ null（同じイベントが 2 回来ても変わらない）
 * - 建った宿（place.lodging）は、泊まる夜の宿にする（withLodgings）
 * - 足すと時間に収まらないときは、場所をしおりから外し、leftOutPinIds に足す（domain/dropToFit.ts。#622）。外すのは、足した場所でも前からある場所でもよい。
 *   足す前のしおりがもう越えていれば（人が行を増やした、など）、足してそれより増える分だけを外す（人が直した内容を壊さない）
 *   ranking は Gemini の残したい順（rankRequest で聞いたもの）。なければ、形が違えば、自分たちの計算の順
 * - flights を渡すと、便が決まっていない・乗れなくなった飛行機の区間の便を探す
 * places は、建った場所のすべて（建った順）。
 */
export function addToDecidedRoute(
  route: AddRoute,
  places: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  flights?: FlightChoices,
  ranking?: readonly string[],
): RouteUpdate | null {
  const placed = placeMissing(route, places, origin, days)
  if (!placed) return null
  const { lodging, meals, missing } = placed
  const fitted = dropToFit(placed.order, origin, fitMeasure(route, lodging, origin, days), ranking, placed.allowance)
  const timing = routeTiming({ ...route, lodging })
  const order = fitted.leftOut.length > 0 ? settleEvents(fitted.order, origin, days, timing, route.legModes) : placed.order
  return {
    // 保存する順番は、buildPlan が返すしおりの行の順（夜景や宿に間に合わない場所を回したあと。#602）
    ...buildPlan(order, origin, days, timing, undefined, route.legModes, flights ?? { saved: route.legFlights }),
    revision: (route.revision ?? 0) + 1,
    addedPinIds: [...(route.addedPinIds ?? []), ...missing.map((place) => place.id).filter((id) => !fitted.leftOut.includes(id))],
    ...(meals !== route.meals && meals ? { meals } : {}),
    ...(fitted.leftOut.length > 0 ? { leftOutPinIds: [...(route.leftOutPinIds ?? []), ...fitted.leftOut] } : {}),
  }
}

/** しおりの回る順番から、Gemini に渡す入力を作る。外さない場所（宿、イベント）は入れない */
export function rankInput(
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  timing: StyleTiming,
  tripTitle: string,
  overMinutes: number,
): RankPlacesInput {
  const groups = placeGroups(order, origin)
  const reach = groupReach(order, origin, groups)
  const wishers = new Map<string, string>()
  const seen = new Set<string>()
  const places: RankPlace[] = []
  for (const place of order) {
    const id = pinOfStop(place.id)
    if (seen.has(id) || isFixedPlace(place)) continue
    seen.add(id)
    if (!wishers.has(place.uid)) wishers.set(place.uid, `人${wishers.size + 1}`)
    const group = groups.get(id) ?? 0
    places.push({
      id,
      name: place.name,
      category: place.category ?? 'other',
      stay: stayMinutesFor(place, timing),
      wisher: wishers.get(place.uid) ?? '人1',
      group: `g${group + 1}`,
      reach: reach.get(group) ?? 0,
    })
  }
  return { tripTitle, days, originName: origin.name, overMinutes: Math.round(overMinutes), places }
}

/** 応答が決めた形か。ranking が文字の配列なら通す（抜けや重なりは domain/dropToFit.ts の validRanking が見て、だめなら自分たちの順に戻す） */
export function parseRanking(json: unknown): RankPlacesOutput {
  const ranking = (json as { ranking?: unknown })?.ranking
  if (!Array.isArray(ranking) || !ranking.every((id) => typeof id === 'string')) throw new Error('ranking は文字の配列が要ります')
  return { ranking: ranking as string[] }
}
