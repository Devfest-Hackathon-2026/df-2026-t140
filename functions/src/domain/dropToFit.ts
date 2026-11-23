// しおりが時間に収まらないとき、どの場所をしおりから外すかを決める（純粋。I/O なし。scripts/drop-to-fit.test.mjs で確かめる）。
// 規則は「時間に収まる範囲で、できるだけ多くの場所を残す」。時間（19 時を越えた分）が条件、外す数を少なくするのが目的、
// 一人に偏らないことは同点のときだけ見る。外した場所はしおりに入れないだけで、建物は地図に残す（Lazyturtle0852 の決定、2026-11-22、#622）。
// 外す順は「残したい順」（Gemini が旅の楽しさで付ける。features/propose-routes の rankPlacesTask）の低いほうから。
// 順がないとき・形が違うときは、自分たちの計算の順（外すと 19 時を越えた分が最も減る順。近い場所の塊ごとも候補）にする。
import type { LatLng } from './pin'
import { isLodgingSkip } from './route'
import { buildPlan, DAY_END_MINUTES, estimateMinutes, settleEvents, type PlanOrigin, type PlanPlace, type StyleTiming } from './routePlan'
import type { LegModes } from './travelMode'
import { defaultLegMode } from './flight'
import { pinOfStop } from './visit'

/** 19 時を越えてもよい分の合計（分）。これ以内なら外さない（実装した AI が仮に選んだ） */
export const OVER_ALLOWANCE_MINUTES = 60
/**
 * 旅の最終日に家（出発地）へ着く時刻の上限（0 時からの分）。最後の場所を 19 時までに出て、ここまでに帰り着けば越えに数えない
 * （スキーのあとに車で帰って 21 時台に着く、はふつうの旅なので。実装した AI が仮に選んだ）
 */
export const HOME_BY_MINUTES = 22 * 60
/** 片道がこの時間（分）以内の場所どうしを、1 つの塊とみなす（実装した AI が仮に選んだ） */
export const GROUP_REACH_MINUTES = 120

/** 回る順番を組んだときの、19 時を越えた分の合計（over）と移動の合計（move）。どちらも分。組み方は呼ぶ側が決める */
export type Measure = (order: readonly PlanPlace[]) => { over: number; move: number }

/**
 * しおりと同じ組み方で組み、19 時（DAY_END_MINUTES）を越えて場所を出る分（over）と、移動の合計（move）を測る。
 * 時刻が決まったイベントがあれば、イベントを守る順に直してから組む（settleEvents。外したあとの順でも、しおりはそう組み直すため）。
 * 宿の行（翌朝まで）とイベントの行（開催の時刻で決まっている）は over に数えない。夜に置いた行（夜景。日の入りのあと）は、19 時を越えても数えない
 * （routePlan.ts の eventCost の over と同じ決め）。旅の最終日の最後の場所は、出発地へ帰る移動（returnMinutes。#602）のあと、
 * 家に着くのが HOME_BY_MINUTES を越えた分も数える
 */
export function measureTrip(origin: PlanOrigin, days: number, timing: StyleTiming, legModes?: LegModes): Measure {
  return (order) => {
    const arranged = order.some((place) => place.event) ? settleEvents(order, origin, days, timing, legModes) : order
    const plan = buildPlan(arranged, origin, days, timing, undefined, legModes)
    const skipped = new Set([
      ...Object.values(plan.lodging ?? timing.lodging ?? {}).filter((value) => !isLodgingSkip(value)),
      ...arranged.filter((place) => place.event || place.lodging || place.category === 'lodging').map((place) => place.id),
    ])
    const over = plan.schedule.reduce((sum, stop) => {
      const id = stop.stopId ?? stop.pinId
      if (id === null || skipped.has(id)) return sum
      const leave = Number(stop.time.slice(0, 2)) * 60 + Number(stop.time.slice(3, 5)) + stop.stayMinutes
      // 夜に置いた行は、19 時を越えて出てもよい
      const end = stop.evening ? Math.max(DAY_END_MINUTES, leave) : DAY_END_MINUTES
      // 旅の最後の行（最終日にあるとき）は、そのあと家へ帰る。家に着くのが HOME_BY_MINUTES を越えた分も数える。
      // 最後の行が最終日より前の日にあれば（あとの日が空いている）、帰りは最終日にできるので数えない
      const home = stop.day === days && stop.returnMinutes !== undefined ? Math.max(0, leave + stop.returnMinutes - HOME_BY_MINUTES) : 0
      return sum + Math.max(0, leave - end) + home
    }, 0)
    return { over, move: plan.totalMoveMinutes }
  }
}

export interface DropResult {
  /** 外したあとの回る順番（もとの順番を保つ） */
  order: PlanPlace[]
  /** しおりから外した場所（ピンの ID。外した順） */
  leftOut: string[]
  /** 残したい順のうち、使った順の出どころ。'given' は渡された順（Gemini）、'own' は自分たちの計算 */
  rankedBy: 'given' | 'own' | 'none'
}

/**
 * 外さない場所か。宿（夜の割り当てが崩れる）、時刻が決まったイベント（開催日に固定）、食事の枠に入れたお店（枠の割り当てが崩れる）は外さない
 * （仮。企画書の仮に決めたこと）
 */
export function isFixedPlace(place: Pick<PlanPlace, 'lodging' | 'event' | 'meal' | 'category'>): boolean {
  // もう夜に割り当てた宿は lodging の印がない（domain/routePlan.ts の PlanPlace）ので、種類でも見る
  return Boolean(place.lodging || place.category === 'lodging' || place.event || place.meal)
}

/** 行の並びにある場所（ピンの ID）を、はじめに出てきた順に */
export function pinIdsOf(order: readonly PlanPlace[]): string[] {
  return [...new Set(order.map((place) => pinOfStop(place.id)))]
}

const without = (order: readonly PlanPlace[], pins: ReadonlySet<string>) => order.filter((place) => !pins.has(pinOfStop(place.id)))

/** 2 つの場所のあいだの移動の目安（分）。旅の移動手段の既定（遠い区間は飛行機）で見る */
function legMinutes(a: LatLng, b: LatLng, origin: PlanOrigin): number {
  return estimateMinutes(a, b, defaultLegMode(a, b, origin.travelMode ?? 'car'))
}

/**
 * 近い場所の塊。片道 GROUP_REACH_MINUTES 以内でつながる場所を 1 つの塊にする（どれか 1 つとつながれば同じ塊）。
 * 返すのは、ピンの ID ごとの塊の番号（0 から）。番号は、塊の最初の場所が order に出てくる順
 */
export function placeGroups(order: readonly PlanPlace[], origin: PlanOrigin): Map<string, number> {
  const pins = uniquePlaces(order)
  const parent = pins.map((_, index) => index)
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])))
  for (let i = 0; i < pins.length; i += 1) {
    for (let j = i + 1; j < pins.length; j += 1) {
      if (legMinutes(pins[i].location, pins[j].location, origin) <= GROUP_REACH_MINUTES) parent[find(j)] = find(i)
    }
  }
  const numberOf = new Map<number, number>()
  const result = new Map<string, number>()
  pins.forEach((place, index) => {
    const root = find(index)
    if (!numberOf.has(root)) numberOf.set(root, numberOf.size)
    result.set(pinOfStop(place.id), numberOf.get(root) ?? 0)
  })
  return result
}

/**
 * 塊ごとの、ほかの塊からいちばん近い場所までの片道（分）。塊が 1 つなら 0。
 * Gemini に「行くだけで時間がかかる場所」を伝えるのに使う（時間を Gemini に見積もらせない）
 */
export function groupReach(order: readonly PlanPlace[], origin: PlanOrigin, groups: ReadonlyMap<string, number>): Map<number, number> {
  const pins = uniquePlaces(order)
  const reach = new Map<number, number>()
  for (const place of pins) {
    const group = groups.get(pinOfStop(place.id)) ?? 0
    let nearest = Infinity
    for (const other of pins) {
      if ((groups.get(pinOfStop(other.id)) ?? 0) === group) continue
      nearest = Math.min(nearest, legMinutes(place.location, other.location, origin))
    }
    const value = Number.isFinite(nearest) ? nearest : 0
    reach.set(group, Math.min(reach.get(group) ?? Infinity, value))
  }
  return reach
}

/** ピンの ID ごとに、最初の行（複製した 2 回目からの行は除く） */
function uniquePlaces(order: readonly PlanPlace[]): PlanPlace[] {
  const seen = new Set<string>()
  return order.filter((place) => {
    const pin = pinOfStop(place.id)
    if (seen.has(pin)) return false
    seen.add(pin)
    return true
  })
}

/**
 * 渡された残したい順（ピンの ID。先頭ほど残したい）が使えるか。外してよい場所がすべて 1 回ずつ入っていればよい。
 * 外さない場所（宿、イベント）は入っていても入っていなくてもよい。知らない ID、重なりがあれば使わない
 */
export function validRanking(ranking: readonly string[] | undefined, order: readonly PlanPlace[]): boolean {
  if (!ranking || ranking.length === 0) return false
  const places = uniquePlaces(order)
  const known = new Set(places.map((place) => pinOfStop(place.id)))
  if (new Set(ranking).size !== ranking.length || ranking.some((id) => !known.has(id))) return false
  const listed = new Set(ranking)
  return places.every((place) => isFixedPlace(place) || listed.has(pinOfStop(place.id)))
}

/** 一度に試す、外す場所の組み合わせの大きさの上限。これより多く外す旅は、1 つずつ外す形で探す */
export const MAX_SEARCH_DROPS = 3
/** Gemini の順で外した数が、自分たちの計算より何個多くまでなら、Gemini の順を採るか（実装した AI が仮に選んだ） */
export const EXTRA_DROPS_FOR_GIVEN = 1

interface Pick_ {
  pins: string[]
  over: number
  move: number
  share: number
}

/** a のほうが良い外し方か：越えが少ない → 移動が少ない（移動が長すぎる旅は楽しくない）→ 場所の多い人の場所 */
function betterPick(a: Pick_, b: Pick_ | null): boolean {
  if (!b) return true
  if (a.over < b.over - 1e-9) return true
  if (a.over > b.over + 1e-9) return false
  if (a.move < b.move - 1e-9) return true
  if (a.move > b.move + 1e-9) return false
  return a.share > b.share
}

function* combinations<T>(items: readonly T[], size: number, from = 0): Generator<T[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let index = from; index <= items.length - size; index += 1) {
    for (const rest of combinations(items, size - 1, index + 1)) yield [items[index], ...rest]
  }
}

/**
 * 自分たちの計算の残したい順。外した場所を順の後ろに並べる（先頭は外さない場所を、もとの順番で）。
 * 1. 外す数が少ない順に（1〜MAX_SEARCH_DROPS 個）、外してよい場所の組み合わせを全部試し、許す幅に収まる組み合わせがあれば、
 *    その数のうち越えが少ない → 移動が少ない → 場所の多い人の場所、の順で良いものを外す（外す数を最小にする）
 * 2. なければ、収まるまで 1 つずつ外す。候補は場所 1 つずつと、近い場所の塊（2 つ以上）ごと。外すと収まる候補があればそのうち数の少ないもの、
 *    なければ「減る越え ÷ 外す数」が大きいもの（同点は 1 と同じ順）
 */
export function ownRanking(order: readonly PlanPlace[], origin: PlanOrigin, measure: Measure, allowance = OVER_ALLOWANCE_MINUTES): string[] {
  const places = uniquePlaces(order)
  const ownerOf = new Map(places.map((place) => [pinOfStop(place.id), place.uid]))
  const removable = places.filter((place) => !isFixedPlace(place)).map((place) => pinOfStop(place.id))
  const shareOf = (current: readonly PlanPlace[], pins: readonly string[]) => {
    const count = new Map<string, number>()
    for (const id of pinIdsOf(current)) count.set(ownerOf.get(id) ?? '', (count.get(ownerOf.get(id) ?? '') ?? 0) + 1)
    return Math.max(...pins.map((id) => count.get(ownerOf.get(id) ?? '') ?? 0))
  }
  const ranked = (dropped: readonly string[]) => [...removable.filter((id) => !dropped.includes(id)), ...[...dropped].reverse()]

  // 外せる場所は、少なくとも 1 つ残す（しおりを空にしない）
  for (let size = 1; size <= Math.min(MAX_SEARCH_DROPS, removable.length - 1); size += 1) {
    let best: Pick_ | null = null
    for (const pins of combinations(removable, size)) {
      const after = measure(without(order, new Set(pins)))
      if (after.over > allowance) continue
      const pick = { pins, ...after, share: shareOf(order, pins) }
      if (betterPick(pick, best)) best = pick
    }
    if (best) return ranked(best.pins)
  }

  const groups = placeGroups(order, origin)
  const dropped: string[] = []
  let current = [...order]
  let { over } = measure(current)
  while (over > allowance) {
    const left = pinIdsOf(current).filter((id) => removable.includes(id))
    if (left.length <= 1) break
    const candidates: string[][] = left.map((id) => [id])
    const byGroup = new Map<number, string[]>()
    for (const id of left) byGroup.set(groups.get(id) ?? -1, [...(byGroup.get(groups.get(id) ?? -1) ?? []), id])
    for (const members of byGroup.values()) if (members.length >= 2 && members.length < left.length) candidates.push(members)
    let fitting: Pick_ | null = null
    let best: (Pick_ & { gain: number }) | null = null
    for (const pins of candidates) {
      const after = measure(without(current, new Set(pins)))
      const pick = { pins, ...after, share: shareOf(current, pins) }
      if (after.over <= allowance) {
        if (!fitting || pins.length < fitting.pins.length || (pins.length === fitting.pins.length && betterPick(pick, fitting))) fitting = pick
        continue
      }
      const gain = (over - after.over) / pins.length
      if (!best || gain > best.gain + 1e-9 || (Math.abs(gain - best.gain) <= 1e-9 && betterPick(pick, best))) best = { ...pick, gain }
    }
    const chosen = fitting ?? (best && best.gain > 0 ? best : null)
    // どれを外しても減らない（宿やイベントだけで越えている）なら、そこでやめる
    if (!chosen) break
    dropped.push(...chosen.pins)
    current = without(current, new Set(chosen.pins))
    over = chosen.over
  }
  return ranked(dropped)
}

/** 残したい順の低いほうから target に収まるまで外し、外しすぎを順の高いほうから戻す */
function dropByRank(order: readonly PlanPlace[], measure: Measure, rank: readonly string[], target: number): { order: PlanPlace[]; leftOut: string[] } {
  const out = new Set<string>()
  const leftOut: string[] = []
  for (const id of [...rank].reverse()) {
    if (measure(without(order, out)).over <= target) break
    // 外せる場所は、少なくとも 1 つ残す（順のいちばん上の場所）
    if (out.size >= rank.length - 1) break
    out.add(id)
    leftOut.push(id)
  }
  for (const id of rank) {
    if (!out.has(id)) continue
    const trial = new Set(out)
    trial.delete(id)
    if (measure(without(order, trial)).over <= target) {
      out.delete(id)
      leftOut.splice(leftOut.indexOf(id), 1)
    }
  }
  return { order: without(order, out), leftOut }
}

/**
 * 回る順番を、時間に収まる形にする。
 * 1. 全部で 19 時を越えた分が許す幅以内なら、何も外さない
 * 2. 自分たちの計算の順（ownRanking）で外す。外しすぎは順の高いほうから戻す
 * 3. 渡された残したい順（Gemini）が使えれば、その低いほうから同じように外し、時間に収まっていて、外す数が自分たちの計算より EXTRA_DROPS_FOR_GIVEN 個多くまでなら、そちらを採る
 *    （外す数は時間の計算で決め、どれを外すかは旅の楽しさで決める）
 * 外せる場所は少なくとも 1 つ残す。外さない場所（宿、イベント）や出発地との行き帰りだけで越えている分は、目指さない（効かない場所まで外さない）
 */
export function dropToFit(
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  measure: Measure,
  ranking?: readonly string[],
  allowance = OVER_ALLOWANCE_MINUTES,
): DropResult {
  if (measure(order).over <= allowance) return { order: [...order], leftOut: [], rankedBy: 'none' }
  const fixed = new Set(uniquePlaces(order).filter(isFixedPlace).map((place) => pinOfStop(place.id)))
  const removable = pinIdsOf(order).filter((id) => !fixed.has(id))
  // 外せる場所を 1 つだけ残したときの越えの、いちばん小さい値。これより下は目指さない
  // （宿やイベント、出発地との行き帰りだけで越えている分は、場所を外しても減らない）
  const floor = Math.min(...removable.map((keep) => measure(without(order, new Set(removable.filter((id) => id !== keep)))).over))
  const target = Math.max(allowance, Number.isFinite(floor) ? floor : 0)
  const own = dropByRank(order, measure, ownRanking(order, origin, measure, target), target)
  if (validRanking(ranking, order)) {
    const given = dropByRank(order, measure, (ranking ?? []).filter((id) => !fixed.has(id)), target)
    // 時間に収まっていて（自分たちの計算より越えが多くなく）、外す数が多すぎなければ採る
    const fits = measure(given.order).over <= Math.max(target, measure(own.order).over)
    if (fits && given.leftOut.length <= own.leftOut.length + EXTRA_DROPS_FOR_GIVEN) return { ...given, rankedBy: 'given' }
  }
  return { ...own, rankedBy: 'own' }
}
