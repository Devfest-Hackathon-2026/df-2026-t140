/**
 * 旅の地図の画面の種類（URL の view から決める）。
 * map：みんなの地図。shiori：地図のしおり（S11、S12、S13）。
 * map-only：地図だけの画面（?view=map）。決まったしおり（S14）の「地図で見る」で開く。確定した旅だけ
 */
export type TripMapView = 'map' | 'shiori' | 'map-only'

/**
 * URL の view と、旅が確定しているかから、出す画面を決める。
 * 地図だけの画面（?view=map）は確定した旅だけ。確定していない（取り消された）旅では地図のしおりを出し、
 * 読み込みが済んでいれば、URL も地図のしおり（?view=shiori）へ置き換える（redirect）
 */
export function tripMapView(view: string | null, confirmed: boolean, loaded: boolean): { screen: TripMapView; redirect: 'shiori' | null } {
  if (view === 'map') {
    if (confirmed) return { screen: 'map-only', redirect: null }
    return { screen: 'shiori', redirect: loaded ? 'shiori' : null }
  }
  return { screen: view === 'shiori' ? 'shiori' : 'map', redirect: null }
}

/** 旅の再生が終わった（最後まで行った、やめた）あとに戻る画面の view。地図だけの画面では、地図だけのまま */
export function tourEndView(screen: TripMapView): 'map' | 'shiori' {
  return screen === 'map-only' ? 'map' : 'shiori'
}
