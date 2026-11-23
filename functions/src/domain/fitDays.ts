// 旅の日程を変えたときに、しおりの回る順番を新しい日数に合わせる（純粋。I/O なし。scripts/edit-trip-dates.test.mjs で確かめる）。
// 日の分け方は domain/routePlan.ts の buildPlan（dayPacker）をそのまま使う。ここは「入りきらない場所をしおりから外す」ことだけを決める
// （Lazyturtle0852 の決定、2026-11-22。企画書「実装で仮に決めたこと（2026-11-07、旅の作成と招待）」の日程の変更の行）
import { isLodgingSkip } from './route'
import { buildPlan, DAY_END_MINUTES, type FlightChoices, type PlanOrigin, type PlanPlace, type StyleTiming } from './routePlan'
import { eventWindow } from './event'
import type { LegModes } from './travelMode'
import { pinOfStop } from './visit'

export interface FitDaysResult {
  /** 新しい日数で回る順番（行の ID が並ぶ。外した場所の行は入らない） */
  order: PlanPlace[]
  /** しおりから外した場所（ピンの ID。外した順） */
  leftOut: string[]
  /** 新しい日程に残る夜の宿（Route.lodging）。宿を 1 つも扱っていなければ undefined */
  lodging: Record<string, string> | undefined
}

/**
 * 回る順番を、新しい日数（days）と開始日（origin.startDate）に合わせる。
 * - 新しい日程にない夜（days 日目より先の夜）の宿は、ほかの夜の宿でもなければ、しおりから外す
 * - 時刻が決まったイベントで、開催日が新しい日程の外になったものは外す
 * - trim が true（日程が縮んだ）のときだけ、最終日の最後の場所が 1 日の終わり（DAY_END_MINUTES。旅の最後の日は、そこから出発地へ帰る移動を引いた時刻）を越えるあいだ、最終日の最後の場所から順に外す。
 *   しおりの場所が最後の 1 つになったら、それ以上は外さない。宿の行とイベントの行は、終わりの時刻を数えない（宿は翌朝まで、イベントは開催の時刻で決まっている）
 * 同じ場所を何度も訪れるしおりで、複製した行（2 回目からの訪問）だけが外れるときは、その行を消すだけで、外した場所には数えない。
 * ピンの ID そのままの行が外れるときは、その場所の行をすべて外す（domain/visit.ts の「ピンの ID の行が必ず 1 つある」を保つ）
 */
export function fitToDays(
  order: readonly PlanPlace[],
  origin: PlanOrigin,
  days: number,
  timing: StyleTiming,
  trim: boolean,
  legModes?: LegModes,
  flights?: FlightChoices,
): FitDaysResult {
  const leftOut: string[] = []
  let current = [...order]
  const dropPin = (pinId: string) => {
    current = current.filter((place) => pinOfStop(place.id) !== pinId)
    if (!leftOut.includes(pinId)) leftOut.push(pinId)
  }

  // 新しい日程に残る夜の宿
  let lodging: Record<string, string> | undefined
  if (timing.lodging) {
    lodging = {}
    for (const [night, value] of Object.entries(timing.lodging)) {
      if (Number(night) >= 1 && Number(night) < days) lodging[night] = value
    }
    const kept = new Set(Object.values(lodging).filter((value) => !isLodgingSkip(value)))
    for (const value of Object.values(timing.lodging)) {
      if (isLodgingSkip(value) || kept.has(value)) continue
      // 前の夜と同じ宿にした夜の宿は、複製した行（「ピンの ID~番号」）。その行だけを消し、外した場所には数えない（宿の建物はほかの夜に残る）
      if (value !== pinOfStop(value)) current = current.filter((place) => place.id !== value)
      else if (current.some((place) => pinOfStop(place.id) === value)) dropPin(value)
    }
  }

  // 開催日が新しい日程の外になったイベント
  if (origin.startDate) {
    for (const place of [...current]) {
      if (place.event && !eventWindow(place.event, origin.startDate, days)) dropPin(pinOfStop(place.id))
    }
  }

  if (!trim) return { order: current, leftOut, lodging }

  const lodgingIds = new Set(Object.values(lodging ?? {}).filter((value) => !isLodgingSkip(value)))
  // 外すたびに 1 行ずつ減るので、行の数より多くは回らない
  for (let guard = current.length; guard > 0; guard -= 1) {
    const plan = buildPlan(current, origin, days, { ...timing, ...(lodging ? { lodging } : {}) }, undefined, legModes, flights)
    const lastDay = Math.max(0, ...plan.schedule.map((stop) => stop.day))
    // 宿の行は、行の ID で見分ける（前の夜と同じ宿にした夜の宿は、複製した行）
    const rows = plan.schedule.filter((stop) => stop.day === lastDay && stop.pinId !== null && !lodgingIds.has(stop.stopId ?? stop.pinId))
    const last = [...rows].reverse().find((stop) => !current.find((place) => place.id === (stop.stopId ?? stop.pinId))?.event)
    // 旅の最後の日は、19 時から出発地へ帰る移動を引いた時刻までに出られるか（しおりのゆとりと同じ決め。domain/slack.ts）
    const home = lastDay === days ? (plan.schedule.at(-1)?.returnMinutes ?? 0) : 0
    if (!last || minutesOf(last.time) + last.stayMinutes <= DAY_END_MINUTES - home) break
    // しおりが空にならないよう、最終日の場所が最後の 1 つなら、それ以上は外さない（実装した AI が仮に選んだ）
    if (current.length <= 1) break
    const rowId = last.stopId ?? last.pinId!
    if (rowId !== pinOfStop(rowId)) current = current.filter((place) => place.id !== rowId)
    else dropPin(rowId)
  }
  return { order: current, leftOut, lodging }
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}
