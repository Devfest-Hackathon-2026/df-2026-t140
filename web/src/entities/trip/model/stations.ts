// 全国の駅の表（model/stationData.ts。国土数値情報の鉄道データから scripts/build-stations.mjs が作る）で、駅名から位置を引く。
// 表は大きい（約 250KB）ので、旅をつくる画面を開いたときだけ読み込む（loadStations）。読み込む前は引けない（null）。
// Functions にも同じ表と同じ引き方がある（functions/src/domain/stations.ts）

type LatLng = { lat: number; lng: number }

let table: Map<string, LatLng> | null = null
let loading: Promise<void> | null = null

/** 駅名の書き方をそろえる。全角と半角をそろえ、前後の空白と、最後の「駅」を外す（「浜田山駅」→「浜田山」） */
export function stationKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/駅$/, '')
}

/** 表の文字（1 行に「駅名<TAB>緯度<TAB>経度」）を、駅名から位置を引く形にする */
export function parseStations(rows: string): Map<string, LatLng> {
  const map = new Map<string, LatLng>()
  for (const line of rows.split('\n')) {
    const [name, lat, lng] = line.split('\t')
    if (name && lat && lng) map.set(name, { lat: Number(lat), lng: Number(lng) })
  }
  return map
}

/** 駅の表を読み込む（何度呼んでも 1 回だけ） */
export function loadStations(): Promise<void> {
  loading ??= import('./stationData')
    .then(({ STATION_ROWS }) => {
      table = parseStations(STATION_ROWS)
    })
    .catch((cause: unknown) => {
      // 読み込めなかったら、次に呼んだときに読み直す
      loading = null
      throw cause
    })
  return loading
}

/** 駅名から位置を引く。表をまだ読み込んでいないか、表にない駅なら null */
export function stationLocation(name: string): LatLng | null {
  return table?.get(stationKey(name)) ?? null
}
