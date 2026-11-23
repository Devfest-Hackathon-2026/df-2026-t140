// しおりから外した場所（Route.leftOutPinIds）を、しおりに戻す（純粋。I/O なし。scripts/edit-trip-dates.test.mjs で確かめる）。
// 日程を変えたとき（features/change-trip-dates）は、時間に収まる場所だけを自動で戻す。
// 場所シートの「しおりに戻す」（features/restore-place）は、人が選んだので、収まらなくても戻す（Takana の決定、2026-11-23、バグ30）
import { type Measure } from './dropToFit'
import { assignMeal, parseMealKey } from './meal'
import { isLodgingSkip } from './route'
import { assignLodging, buildPlan, dayPacker, type PlanOrigin, type PlanPlace, type StyleTiming } from './routePlan'
import type { LegModes } from './travelMode'

export interface PlaceBackState {
  /** 回る順番（行の ID が並ぶ） */
  order: PlanPlace[]
  /** 泊まる夜ごとの宿（Route.lodging）。宿を 1 つも扱っていなければ undefined */
  lodging: Record<string, string> | undefined
  /** ごはんの枠（Route.meals）。なければ undefined */
  meals: Record<string, string> | undefined
}

export interface PlaceBackContext {
  origin: PlanOrigin
  days: number
  /** しおりの時間の決め（宿は state.lodging を使うので、ここの lodging は見ない） */
  timing: StyleTiming
  legModes?: LegModes
  /** 宿の割り当てごとの物差し（19 時を越えた分と移動。domain/dropToFit.ts の measureTrip） */
  measure: (lodging: Record<string, string> | undefined) => Measure
}

const withLodging = (timing: StyleTiming, lodging: Record<string, string> | undefined): StyleTiming => {
  const { lodging: _old, ...rest } = timing
  return lodging ? { ...rest, lodging } : rest
}

/**
 * 外した場所を 1 つ、しおりに入れる。
 * - 宿は、空いている夜の宿にする（domain/routePlan.ts の assignLodging）
 * - ごはんのお店は、枠の日が日程の中で、その枠が空いていれば、その枠に入れる（domain/meal.ts の assignMeal）
 * - それ以外（と、枠が空いていないお店、夜が空いていない宿）は、入れられる位置を全部組んでみて、19 時を越える分 → 移動の合計 がいちばん少ない位置に入れる
 *   （日の分け方は前から詰めるので、移動だけで選ぶと、ゆとりのある日があっても詰まった日に入ることがある。バグ30）
 * options.lodgingNightOnly が true なら、夜が空いていない宿は入れず null を返す
 */
export function placeBack(state: PlaceBackState, place: PlanPlace, ctx: PlaceBackContext, options: { lodgingNightOnly?: boolean } = {}): PlaceBackState | null {
  const timing = withLodging(ctx.timing, state.lodging)
  if (place.lodging || place.category === 'lodging') {
    const pack = timing.stayScale !== undefined ? dayPacker(ctx.origin, timing) : undefined
    const assigned = assignLodging(state.order, place, ctx.days, state.lodging, place.lodging?.want ?? null, pack)
    if (assigned) return { ...state, order: spreadAfterInn(assigned.order, place, assigned.night, assigned.lodging, ctx), lodging: assigned.lodging }
    // 自動で戻すとき（refill）は、空いた夜がなければ宿を戻さない（日中の場所として入れない。PR #749 のレビュー）
    if (options.lodgingNightOnly) return null
  }
  const slot = parseMealKey(place.meal)
  if (slot && slot.day <= ctx.days) {
    const plan = buildPlan(state.order, ctx.origin, ctx.days, timing, undefined, ctx.legModes)
    const stayIds = Object.values(state.lodging ?? {}).filter((value) => !isLodgingSkip(value))
    const assigned = assignMeal(state.order, place, { schedule: plan.schedule, pinIds: state.order.map((item) => item.id) }, state.meals, stayIds)
    if (assigned) return { ...state, order: assigned.order, meals: assigned.meals }
  }
  const measure = ctx.measure(state.lodging)
  let best: { order: PlanPlace[]; over: number; move: number } | null = null
  // 同じなら後ろのほう（これからの予定を動かさない。routePlan.ts の insertionIndex と同じ）
  for (let index = state.order.length; index >= 0; index -= 1) {
    const order = [...state.order.slice(0, index), place, ...state.order.slice(index)]
    const { over, move } = measure(order)
    if (!best || over < best.over - 1e-9 || (Math.abs(over - best.over) <= 1e-9 && move < best.move - 1e-9)) best = { order, over, move }
  }
  return { ...state, order: best?.order ?? [...state.order, place] }
}

/**
 * 宿が回る順番のいちばん後ろに入った（その夜より後の日に場所がない）ときは、前の宿からの場所を、残りの日数に合わせて宿の前後に分ける。
 * 日程を延ばして宿を戻したときに、最後の日が空いたままにならないように（バグ30）。19 時を越える分が増えるなら、後ろのままにする
 */
function spreadAfterInn(
  order: PlanPlace[],
  inn: PlanPlace,
  night: number,
  lodging: Record<string, string>,
  ctx: PlaceBackContext,
): PlanPlace[] {
  if (order.at(-1)?.id !== inn.id || night >= ctx.days) return order
  // 前の夜の宿（この宿より前の夜で、順番にある宿）。なければ旅の 1 日目から
  let prevNight = 0
  let from = 0
  for (let earlier = night - 1; earlier >= 1; earlier -= 1) {
    const index = order.findIndex((item) => item.id === lodging[String(earlier)])
    if (index >= 0) {
      prevNight = earlier
      from = index + 1
      break
    }
  }
  const segment = order.slice(from, -1)
  if (segment.length < 2) return order
  const before = Math.min(segment.length - 1, Math.max(1, Math.round((segment.length * (night - prevNight)) / (ctx.days - prevNight))))
  const spread = [...order.slice(0, from), ...segment.slice(0, before), inn, ...segment.slice(before)]
  const measure = ctx.measure(lodging)
  return measure(spread).over <= measure(order).over + 1e-9 ? spread : order
}

/**
 * 外した場所を、時間に収まる（19 時を越えた分の合計が target 以内の）ものだけ、candidates の順にしおりに戻す。
 * 戻せなかった場所は、そのまま外しておく。restored は戻した場所（ピンの ID。戻した順）
 */
export function refill(
  state: PlaceBackState,
  candidates: readonly PlanPlace[],
  ctx: PlaceBackContext,
  target: number,
): PlaceBackState & { restored: string[] } {
  let current = state
  const restored: string[] = []
  for (const place of candidates) {
    // 宿は、空いた夜の宿にできるときだけ戻す
    const trial = placeBack(current, place, ctx, { lodgingNightOnly: true })
    if (!trial || ctx.measure(trial.lodging)(trial.order).over > target + 1e-9) continue
    current = trial
    restored.push(place.id)
  }
  return { ...current, restored }
}
