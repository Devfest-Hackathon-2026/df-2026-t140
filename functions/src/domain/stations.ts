// 全国の駅の表（domain/stationData.ts。国土数値情報の鉄道データから scripts/build-stations.mjs が作る）で、駅名から位置を引く。
// 画面にも同じ表と同じ引き方がある（web/src/entities/trip/model/stations.ts）
import type { LatLng } from './pin'
import { STATION_ROWS } from './stationData'

/** 駅名の書き方をそろえる。全角と半角をそろえ、前後の空白と、最後の「駅」を外す（「浜田山駅」→「浜田山」） */
export function stationKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/駅$/, '')
}

let table: Map<string, LatLng> | null = null

/** 駅名から位置を引く。表にない駅なら null。表は、最初に引いたときに作る（関数の起動のたびに作らないように） */
export function stationLocation(name: string): LatLng | null {
  if (!table) {
    table = new Map()
    for (const line of STATION_ROWS.split('\n')) {
      const [key, lat, lng] = line.split('\t')
      if (key && lat && lng) table.set(key, { lat: Number(lat), lng: Number(lng) })
    }
  }
  return table.get(stationKey(name)) ?? null
}
