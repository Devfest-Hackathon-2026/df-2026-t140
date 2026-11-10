// 場所の情報（S12）の小さな決め。純粋な関数だけ（スワイプの判定は、場所カードと共通なので shared/lib/swipe.ts）。

/** 場所の名前（とあたりの地名）で Google マップを開く URL（Maps URLs。キーも Maps の内容も使わない） */
export function placeSearchUrl(name: string, area: string | null | undefined): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(area ? `${name} ${area}` : name)}`
}
