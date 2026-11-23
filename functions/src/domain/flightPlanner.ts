// 飛行機の区間の便を、時刻表から決める planner（純粋。I/O なし）。しおりを作る・組み直す機能（propose-routes、reorder-shiori、
// remove-building、resolve-origin、change-travel-mode、change-leg-mode、set-stop-time）が使う。
// domain/flight.ts と domain/routePlan.ts の両方を使うので、循環しないよう別のファイルに置く。
// searchingFlights だけは計算ではなく、渡された処理（時刻表の読み込み、しおりを組んで書く処理）を順に走らせる殻。自分では I/O をしない
// （機能どうしは直接使えないので、7 つの機能に共通の流れとしてここに置く）
import { type LegFlight, planFlight, type Timetable } from './flight'
import type { LatLng } from './pin'
import { estimateMinutes, type FlightChoices, type PlanOrigin } from './routePlan'
import { groundMode } from './travelMode'

/** 旅の 1 日目（YYYY-MM-DD）から、day 日目の日付 */
export function dateOfDay(startDate: string, day: number): string {
  const [year, month, date] = startDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + day - 1)).toISOString().slice(0, 10)
}

/**
 * 時刻表から飛行機の区間の便を決める planner。空港まで・空港からは、旅全体の手段で見積もる（domain/flight.ts）。
 * timetable が null なら距離の式の目安
 */
export function flightPlanner(timetable: Timetable | null, origin: PlanOrigin, startDate: string): FlightChoices['plan'] {
  const ground = (from: LatLng, to: LatLng) => estimateMinutes(from, to, groundMode(origin.travelMode ?? 'car'))
  return (from, to, departAt, day): LegFlight => ({ ...planFlight({ from, to, departAt, date: dateOfDay(startDate, day), ground }, timetable), day })
}

/** 時刻表を読まずに組んでいる途中で、便を探す区間が出てきた印（searchingFlights が受け取り、時刻表を読んで組み直す） */
export class TimetableNeeded extends Error {
  constructor() {
    super('飛行機の便を探す区間があるので、時刻表を読んで組み直します')
    this.name = 'TimetableNeeded'
  }
}

/**
 * しおりを組むときに buildPlan へ渡す、便の決め方を作る。saved はルートに残してある便（Route.legFlights）。
 * replanAll が true なら、残してある便に乗れても、全部の飛行機の区間の便を決め直す（便を選んだときの前提が変わったとき：
 * 時刻を直した、集合場所を変えた、空港までの手段が変わった）。false なら、便が決まっていない区間と、残した便に乗れなくなった区間だけ探す
 */
export type FlightSearch = (origin: PlanOrigin, startDate: string, saved: FlightChoices['saved'], replanAll?: boolean) => FlightChoices

/**
 * 押さなくても便が出るように、しおりを組む処理（attempt）を、飛行機の便を探しながら走らせる（かめの決定、2026-11-20、#482）。
 * まず時刻表を読まずに走らせる。便を探す区間（便が決まっていない、残した便に乗れなくなった飛行機の区間。replanAll なら飛行機の区間のどれでも）が出てきたら、
 * そこで止め（TimetableNeeded を投げる。トランザクションの中なら何も書かずに戻る）、時刻表を読んでからもう一度走らせる。
 * 飛行機の区間がない旅では時刻表を読まないので、時刻表の取得が遅い・失敗するときに、関係のない操作を待たせない。
 * 時刻表が取れなければ（load が null）、残してある便（乗れなくなっていれば外す）か距離の式の目安で組む。
 * attempt は 2 回走ることがあるので、トランザクションの外へは書き込まないこと（トランザクションの中の書き込みは、止めたときに戻る。
 * いくつかのルートを順に組んで書く usecase で、途中のルートで止まっても、先に書いた分は残らない）
 */
export async function searchingFlights<T>(load: () => Promise<Timetable | null>, attempt: (search: FlightSearch) => Promise<T>): Promise<T> {
  try {
    return await attempt((_origin, _startDate, saved, replanAll = false) => ({
      saved,
      fillMissing: !replanAll,
      plan: () => {
        throw new TimetableNeeded()
      },
    }))
  } catch (error) {
    if (!(error instanceof TimetableNeeded)) throw error
  }
  const timetable = await load()
  return attempt((origin, startDate, saved, replanAll = false) =>
    timetable ? { saved, fillMissing: !replanAll, plan: flightPlanner(timetable, origin, startDate) } : { saved, fillMissing: true },
  )
}
