import { regionRings } from './regionShapes'
import type { RegionId } from './trip'

// 大まかな場所（地方）と、その中の都道府県。旅を作った人が選んだ地方の中にだけ、候補のピンを立てる（#373）。
// 地方の ID と分け方は、画面側の web/src/entities/trip/model/regions.ts と合わせる。

export const REGION_PREFECTURES: Record<RegionId, readonly string[]> = {
  hokkaido: ['北海道'],
  tohoku: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  kanto: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  koshinetsu: ['新潟県', '山梨県', '長野県'],
  hokuriku: ['富山県', '石川県', '福井県'],
  tokai: ['岐阜県', '静岡県', '愛知県', '三重県'],
  kinki: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  chugoku: ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  shikoku: ['徳島県', '香川県', '愛媛県', '高知県'],
  kyushu: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県'],
  okinawa: ['沖縄県'],
}

export const REGION_NAMES: Record<RegionId, string> = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  koshinetsu: '甲信越',
  hokuriku: '北陸',
  tokai: '東海',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州',
  okinawa: '沖縄',
}

export const REGION_IDS = Object.keys(REGION_PREFECTURES) as RegionId[]

/**
 * 候補を絞る地方。旅に地方がない（地方を選ぶ画面を足す前の旅）か、すべて選んでいるときは null（絞らない）。
 * 知らない ID は捨てる
 */
export function limitingRegions(regions: readonly string[] | undefined | null): RegionId[] | null {
  const known = REGION_IDS.filter((id) => regions?.includes(id))
  return known.length === 0 || known.length === REGION_IDS.length ? null : known
}

/** 地方の中の都道府県の名前の集まり */
export function prefecturesOf(regions: readonly RegionId[]): Set<string> {
  return new Set(regions.flatMap((id) => REGION_PREFECTURES[id]))
}

/** その都道府県がある地方。知らない名前なら null */
export function regionOfPrefecture(prefecture: string): RegionId | null {
  return REGION_IDS.find((id) => REGION_PREFECTURES[id].includes(prefecture)) ?? null
}

/** 点が輪の中にあるか（緯度経度をそのまま平面として扱う。地方の大きさなら十分） */
function insideRing(lat: number, lng: number, ring: readonly { lat: number; lng: number }[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.lat > lat !== b.lat > lat && lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
  }
  return inside
}

/**
 * その位置がある地方。地方の形（domain/regionShapes.ts）の中にあればその地方、
 * どの形の中にもなければ（海岸のすぐそば、形から落とした小さな島）、いちばん近い形の角の地方
 */
export function regionAt(location: { lat: number; lng: number }): RegionId {
  let nearest: RegionId = REGION_IDS[0]
  let nearestGap = Infinity
  for (const id of REGION_IDS) {
    for (const ring of regionRings(id)) {
      if (insideRing(location.lat, location.lng, ring)) return id
      for (const point of ring) {
        const gap = (point.lat - location.lat) ** 2 + ((point.lng - location.lng) * Math.cos((location.lat * Math.PI) / 180)) ** 2
        if (gap < nearestGap) {
          nearestGap = gap
          nearest = id
        }
      }
    }
  }
  return nearest
}

/**
 * 候補を絞る県の名前の集まり。県まで絞った旅はその県、地方だけの旅はその地方の県。
 * 絞らない旅（地方がない、すべて選んだ）は null
 */
export function allowedPrefectures(trip: { regions?: readonly string[]; prefectures?: readonly string[] } | undefined): Set<string> | null {
  const known = new Set(REGION_IDS.flatMap((id) => REGION_PREFECTURES[id]))
  const regions = limitingRegions(trip?.regions)
  const inRegions = regions ? prefecturesOf(regions) : null
  // 県は、選んだ地方の中のものだけを使う（地方と食い違う県が書かれていても、画面の塗りや帯と同じ範囲にする）
  const narrowed = (trip?.prefectures ?? []).filter((name) => known.has(name) && (!inRegions || inRegions.has(name)))
  if (narrowed.length > 0) return narrowed.length === known.size ? null : new Set(narrowed)
  return inRegions
}
