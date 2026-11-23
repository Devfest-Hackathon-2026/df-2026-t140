import { clockAfter, clockLabel, clockMinutes, translate } from '@/shared/lib'
import { MEET_KEY, ORIGIN_KEY } from './legs'
import type { RouteStop } from './types'
import { stopIdOf } from './visits'

/** しおりの行の時刻の種類。meet：集合時間、depart：出発時間（集合場所の行）、arrive：場所に着く時刻、leave：場所を出る時刻 */
export type StopTimeKind = 'meet' | 'depart' | 'arrive' | 'leave'

/**
 * Route.stopTimes のキーで、場所を出る時刻を表す印。行の ID のうしろに付ける（例：ピンの ID@leave）。
 * Functions 側は functions/src/domain/visit.ts の LEAVE_MARK
 */
export const LEAVE_MARK = '@leave'

/** しおりの行に出す時刻 1 つ。key は、直すときに Functions に渡すキー（Route.stopTimes のキー） */
export interface StopTimeSlot {
  key: string
  kind: StopTimeKind
  /** HH:MM */
  time: string
}

/** 時刻の前に出す短い札。着く時刻には札を付けない（場所の行の時刻は、ずっと着く時刻だったため） */
// 場所の行も、集合場所の行と同じく「到着」「出発」の 2 段で出す（かめの依頼、2026-11-21。出発は stopLeaveTime）
export const STOP_TIME_TAGS: Record<StopTimeKind, string | null> = {
  meet: translate('集合', 'Meet'),
  depart: translate('出発', 'Depart'),
  arrive: translate('到着', 'Arrive'),
  leave: translate('出発', 'Depart'),
}
/** 読み上げと、直すときの欄の名前 */
export const STOP_TIME_NAMES: Record<StopTimeKind, string> = {
  meet: translate('集合時間', 'Meeting time'),
  depart: translate('出発時間', 'Departure time'),
  arrive: translate('着く時刻', 'Arrival time'),
  leave: translate('出る時刻', 'Departure time'),
}

/** 集合時間がない前の形の行で、出発の何分前を集合時間として出すか。Functions の MEET_LEAD_MINUTES と合わせる */
const MEET_LEAD_MINUTES = 15

/** HH:MM の minutes 分前（0 時より前にはしない） */
function earlierClock(time: string, minutes: number): string {
  return clockLabel(Math.max(0, (clockMinutes(time) ?? 0) - minutes))
}

/**
 * しおりの行に出す時刻。集合場所の行は集合時間と出発時間の 2 つ（しおりではいつも分けて出す。Takana の依頼、2026-11-19）、
 * 場所の行は着く時刻の 1 つ。時刻のない行（出発地の位置が分からず、画面で足した集合場所の行）は出さない
 */
export function stopTimeSlots(stop: Pick<RouteStop, 'pinId' | 'stopId' | 'time' | 'meetTime'>): StopTimeSlot[] {
  if (!/^\d{2}:\d{2}$/.test(stop.time)) return []
  // 場所の行のキーは行の ID（同じ場所を何度も訪れるしおりでは、行ごとに着く時刻を直せる）
  const stopId = stopIdOf(stop)
  if (stopId) return [{ key: stopId, kind: 'arrive', time: stop.time }]
  return [
    { key: MEET_KEY, kind: 'meet', time: stop.meetTime ?? earlierClock(stop.time, MEET_LEAD_MINUTES) },
    { key: ORIGIN_KEY, kind: 'depart', time: stop.time },
  ]
}

/**
 * 場所を出る時刻（着く時刻に、そこにいる時間を足したもの。HH:MM）。しおりの行で、着く時刻（到着）の下に「出発」として出す。
 * いる時間が 0 分（出る時刻を着く時刻より早く直した）なら、着く時刻と同じ。
 * 集合場所の行と時刻のない行は null。0 時をまたいだら、次の日の時刻に折り返す
 */
export function stopLeaveTime(stop: Pick<RouteStop, 'pinId' | 'time' | 'stayMinutes'>): string | null {
  if (!stop.pinId || clockMinutes(stop.time) === null) return null
  return clockAfter(stop.time, stop.stayMinutes) ?? stop.time
}

/**
 * 場所の行の、出る時刻の欄。押して直すと、その場所にいる時間が変わる（Functions の buildPlan。キーは行の ID@leave）。
 * 集合場所の行と時刻のない行は null
 */
export function stopLeaveSlot(stop: Pick<RouteStop, 'pinId' | 'stopId' | 'time' | 'stayMinutes'>): StopTimeSlot | null {
  const stopId = stopIdOf(stop)
  const time = stopLeaveTime(stop)
  return stopId && time ? { key: `${stopId}${LEAVE_MARK}`, kind: 'leave', time } : null
}
