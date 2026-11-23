// 飛行機の時刻表（ANA・JAL の国内線と空港）を読む口の型（ポート）。実体は adapters/odpt.ts（公共交通オープンデータセンター）。
// 時刻表はメモリーにだけ持ち、保存も公開もしない（ODPT 基本ライセンス 第8条）
import type { Timetable } from '../domain/flight'

export interface FlightsPort {
  /** 時刻表。キーがない、取れないときは null（距離の式の目安になる） */
  timetable(): Promise<Timetable | null>
}
