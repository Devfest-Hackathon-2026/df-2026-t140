import type { MapBounds } from '@/entities/wish'

// いま地図で見ているあたりの名前。「このあたりから探す」を画面に出すために使う。
// 見ている広さ（経度の幅）で段を変える：日本全体 → 地方 → 都道府県 → 市町村 → 駅や名所。
// 位置は、このリポジトリで書いたおよその値（このファイルの下の表）。Maps からは取らない。

const REGIONS: [name: string, lat: number, lng: number][] = [
  ['北海道', 43.4, 142.6],
  ['東北', 39.2, 140.7],
  ['関東', 36.0, 139.7],
  ['甲信越', 36.7, 138.3],
  ['北陸', 36.6, 136.8],
  ['東海', 35.0, 137.3],
  ['近畿', 34.7, 135.6],
  ['中国', 34.9, 132.9],
  ['四国', 33.7, 133.5],
  ['九州', 32.8, 130.9],
  ['沖縄', 26.4, 127.8],
]

/** これより広く（経度の幅）映していたら、日本全体から探す。Functions の決め（suggest-places の logic）と合わせる */
const WIDE_LNG_SPAN = 12

export const REGION_POINTS = REGIONS.map(([name, lat, lng]) => ({ name, lat, lng }))

/**
 * 段を切り替える経度の幅（度）。スマホの幅（約 390px）では、ズーム 7.5 ぐらいで地方、10 ぐらいで都道府県、
 * 12.5 ぐらいで市町村、それより寄せると駅や名所になる。仮に決めた値（feat/view-label-detail の PR に書く）
 */
export const SPAN = { region: 2.5, prefecture: 0.4, town: 0.06 } as const

/** 真ん中から、この距離（km）より遠い市町村や駅は「このあたり」とは呼ばない */
const NEAR_KM = { prefectureByTown: 25, town: 15, spot: 3, townWhenClose: 8 } as const

function distanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(to.lat - from.lat)
  const dLng = radians(to.lng - from.lng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

/** 真ん中にいちばん近い点。maxKm より遠ければ undefined */
function nearest(points: readonly NamedPoint[], center: { lat: number; lng: number }, maxKm = Infinity) {
  let best: NamedPoint | undefined
  let bestKm = maxKm
  for (const item of points) {
    const km = distanceKm(center, item)
    if (km <= bestKm) {
      best = item
      bestKm = km
    }
  }
  return best
}

/** 都道府県の名前。近くに市町村があればその県（県境の近くでも外しにくい）、なければ県の真ん中がいちばん近い県 */
function prefectureName(center: { lat: number; lng: number }): string {
  return nearest(TOWNS, center, NEAR_KM.prefectureByTown)?.prefecture ?? nearest(PREFECTURES, center)?.name ?? '日本全体'
}

/** 地方の名前を、映っているものから真ん中に近い順に 2 つまで（「甲信越・関東」）。1 つもなければ、いちばん近い地方 */
function regionNames(bounds: MapBounds, center: { lat: number; lng: number }): string {
  const inside = REGIONS.filter(
    ([, regionLat, regionLng]) =>
      regionLat <= bounds.north && regionLat >= bounds.south && regionLng <= bounds.east && regionLng >= bounds.west,
  )
  const byDistance = (list: typeof REGIONS) =>
    [...list].sort(
      (left, right) =>
        Math.hypot(left[1] - center.lat, left[2] - center.lng) - Math.hypot(right[1] - center.lat, right[2] - center.lng),
    )
  return (inside.length > 0 ? byDistance(inside).slice(0, 2) : byDistance(REGIONS).slice(0, 1)).map(([name]) => name).join('・')
}

/** 「日本全体」「甲信越・関東」「長野県」「白馬村」「白馬駅」など。画面では「〜のあたりから探します」と続ける */
export function describeBounds(bounds: MapBounds): string {
  const span = bounds.east - bounds.west
  if (span >= WIDE_LNG_SPAN) return '日本全体'
  const center = { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }
  if (span >= SPAN.region) return regionNames(bounds, center)
  if (span >= SPAN.prefecture) return prefectureName(center)
  if (span >= SPAN.town) return nearest(TOWNS, center, NEAR_KM.town)?.name ?? prefectureName(center)
  return (
    nearest(SPOTS, center, NEAR_KM.spot)?.name ??
    nearest(TOWNS, center, NEAR_KM.townWhenClose)?.name ??
    prefectureName(center)
  )
}

// ---- 都道府県・市町村・駅や名所のおよその位置の表 ----
// 位置はこのリポジトリで書いたおよその値（AI に書かせた）。Maps から取ったものではない（Maps Platform 規約 3.2.3）。
// 都道府県の位置は functions/src/features/suggest-places/logic/areas.ts と同じ値。

export interface NamedPoint {
  name: string
  /** 都道府県（都道府県そのものなら自分の名前） */
  prefecture: string
  lat: number
  lng: number
}

const point = (name: string, prefecture: string, lat: number, lng: number): NamedPoint => ({ name, prefecture, lat, lng })
const pref = (name: string, lat: number, lng: number) => point(name, name, lat, lng)

export const PREFECTURES: readonly NamedPoint[] = [
  pref('北海道', 43.2, 142.8), pref('青森県', 40.7, 140.8), pref('岩手県', 39.6, 141.3), pref('宮城県', 38.4, 140.9),
  pref('秋田県', 39.7, 140.3), pref('山形県', 38.4, 140.1), pref('福島県', 37.4, 140.2), pref('茨城県', 36.3, 140.3),
  pref('栃木県', 36.7, 139.8), pref('群馬県', 36.5, 139.0), pref('埼玉県', 36.0, 139.4), pref('千葉県', 35.5, 140.2),
  pref('東京都', 35.69, 139.6), pref('神奈川県', 35.4, 139.4), pref('新潟県', 37.5, 138.9), pref('富山県', 36.7, 137.2),
  pref('石川県', 36.8, 136.7), pref('福井県', 35.9, 136.2), pref('山梨県', 35.6, 138.6), pref('長野県', 36.2, 138.0),
  pref('岐阜県', 35.8, 137.0), pref('静岡県', 35.0, 138.4), pref('愛知県', 35.0, 137.2), pref('三重県', 34.5, 136.4),
  pref('滋賀県', 35.2, 136.1), pref('京都府', 35.2, 135.5), pref('大阪府', 34.6, 135.5), pref('兵庫県', 35.0, 134.8),
  pref('奈良県', 34.3, 135.9), pref('和歌山県', 33.9, 135.4), pref('鳥取県', 35.4, 133.8), pref('島根県', 35.1, 132.6),
  pref('岡山県', 34.9, 133.8), pref('広島県', 34.6, 132.8), pref('山口県', 34.2, 131.6), pref('徳島県', 33.9, 134.2),
  pref('香川県', 34.2, 133.9), pref('愛媛県', 33.6, 132.9), pref('高知県', 33.4, 133.4), pref('福岡県', 33.6, 130.6),
  pref('佐賀県', 33.3, 130.1), pref('長崎県', 33.0, 129.8), pref('熊本県', 32.6, 130.8), pref('大分県', 33.2, 131.4),
  pref('宮崎県', 32.2, 131.3), pref('鹿児島県', 31.6, 130.6), pref('沖縄県', 26.5, 127.9),
]

/** 市町村（東京の区を含む）。県庁のある市と、旅先になりやすい町を中心に */
export const TOWNS: readonly NamedPoint[] = [
  point('札幌市', '北海道', 43.06, 141.35), point('小樽市', '北海道', 43.19, 141.0), point('函館市', '北海道', 41.77, 140.73),
  point('富良野市', '北海道', 43.34, 142.38), point('美瑛町', '北海道', 43.59, 142.47), point('ニセコ町', '北海道', 42.8, 140.69),
  point('倶知安町', '北海道', 42.9, 140.76), point('青森市', '青森県', 40.82, 140.74), point('盛岡市', '岩手県', 39.7, 141.15),
  point('仙台市', '宮城県', 38.27, 140.87), point('秋田市', '秋田県', 39.72, 140.1), point('山形市', '山形県', 38.24, 140.36),
  point('福島市', '福島県', 37.76, 140.47), point('水戸市', '茨城県', 36.37, 140.47), point('宇都宮市', '栃木県', 36.56, 139.88),
  point('日光市', '栃木県', 36.72, 139.7), point('前橋市', '群馬県', 36.39, 139.06), point('草津町', '群馬県', 36.62, 138.6),
  point('さいたま市', '埼玉県', 35.86, 139.65), point('千葉市', '千葉県', 35.61, 140.12), point('千代田区', '東京都', 35.69, 139.75),
  point('中央区', '東京都', 35.67, 139.77), point('港区', '東京都', 35.66, 139.75), point('新宿区', '東京都', 35.69, 139.7),
  point('渋谷区', '東京都', 35.66, 139.7), point('台東区', '東京都', 35.71, 139.78), point('横浜市', '神奈川県', 35.44, 139.64),
  point('鎌倉市', '神奈川県', 35.32, 139.55), point('箱根町', '神奈川県', 35.23, 139.05), point('新潟市', '新潟県', 37.92, 139.04),
  point('湯沢町', '新潟県', 36.93, 138.82), point('富山市', '富山県', 36.7, 137.21), point('金沢市', '石川県', 36.56, 136.66),
  point('福井市', '福井県', 36.06, 136.22), point('甲府市', '山梨県', 35.66, 138.57), point('富士河口湖町', '山梨県', 35.5, 138.75),
  point('富士吉田市', '山梨県', 35.49, 138.81), point('長野市', '長野県', 36.65, 138.19), point('松本市', '長野県', 36.24, 137.97),
  point('安曇野市', '長野県', 36.3, 137.9), point('白馬村', '長野県', 36.7, 137.86), point('軽井沢町', '長野県', 36.35, 138.6),
  point('野沢温泉村', '長野県', 36.92, 138.44), point('山ノ内町', '長野県', 36.74, 138.41), point('岐阜市', '岐阜県', 35.42, 136.76),
  point('高山市', '岐阜県', 36.15, 137.25), point('下呂市', '岐阜県', 35.8, 137.24), point('白川村', '岐阜県', 36.27, 136.9),
  point('静岡市', '静岡県', 34.98, 138.38), point('熱海市', '静岡県', 35.1, 139.07), point('伊東市', '静岡県', 34.97, 139.1),
  point('名古屋市', '愛知県', 35.18, 136.91), point('津市', '三重県', 34.72, 136.51), point('伊勢市', '三重県', 34.49, 136.71),
  point('鳥羽市', '三重県', 34.48, 136.84), point('大津市', '滋賀県', 35.0, 135.87), point('京都市', '京都府', 35.01, 135.77),
  point('大阪市', '大阪府', 34.69, 135.5), point('神戸市', '兵庫県', 34.69, 135.2), point('姫路市', '兵庫県', 34.82, 134.69),
  point('奈良市', '奈良県', 34.69, 135.8), point('和歌山市', '和歌山県', 34.23, 135.17), point('白浜町', '和歌山県', 33.68, 135.35),
  point('鳥取市', '鳥取県', 35.5, 134.24), point('松江市', '島根県', 35.47, 133.05), point('出雲市', '島根県', 35.37, 132.75),
  point('岡山市', '岡山県', 34.66, 133.92), point('倉敷市', '岡山県', 34.59, 133.77), point('広島市', '広島県', 34.39, 132.46),
  point('廿日市市', '広島県', 34.35, 132.33), point('山口市', '山口県', 34.18, 131.47), point('徳島市', '徳島県', 34.07, 134.56),
  point('高松市', '香川県', 34.34, 134.05), point('松山市', '愛媛県', 33.84, 132.77), point('高知市', '高知県', 33.56, 133.53),
  point('福岡市', '福岡県', 33.59, 130.4), point('佐賀市', '佐賀県', 33.26, 130.3), point('長崎市', '長崎県', 32.75, 129.88),
  point('熊本市', '熊本県', 32.8, 130.71), point('大分市', '大分県', 33.24, 131.61), point('別府市', '大分県', 33.28, 131.49),
  point('由布市', '大分県', 33.18, 131.43), point('宮崎市', '宮崎県', 31.91, 131.42), point('鹿児島市', '鹿児島県', 31.6, 130.56),
  point('那覇市', '沖縄県', 26.21, 127.68), point('本部町', '沖縄県', 26.66, 127.88),
]

/** 駅と名所。いちばん寄せたときに「白馬駅のあたり」と出す */
export const SPOTS: readonly NamedPoint[] = [
  point('札幌駅', '北海道', 43.069, 141.351), point('小樽駅', '北海道', 43.198, 140.994), point('函館駅', '北海道', 41.773, 140.726),
  point('富良野駅', '北海道', 43.342, 142.383), point('仙台駅', '宮城県', 38.26, 140.882), point('日光東照宮', '栃木県', 36.758, 139.599),
  point('草津温泉', '群馬県', 36.623, 138.596), point('東京駅', '東京都', 35.681, 139.767), point('新宿駅', '東京都', 35.69, 139.7),
  point('渋谷駅', '東京都', 35.658, 139.702), point('浅草', '東京都', 35.711, 139.796), point('横浜駅', '神奈川県', 35.466, 139.622),
  point('鎌倉駅', '神奈川県', 35.319, 139.55), point('箱根湯本駅', '神奈川県', 35.233, 139.106), point('越後湯沢駅', '新潟県', 36.936, 138.809),
  point('金沢駅', '石川県', 36.578, 136.648), point('兼六園', '石川県', 36.562, 136.663), point('河口湖駅', '山梨県', 35.498, 138.769),
  point('長野駅', '長野県', 36.643, 138.189), point('善光寺', '長野県', 36.661, 138.187), point('松本駅', '長野県', 36.231, 137.964),
  point('松本城', '長野県', 36.239, 137.969), point('上高地', '長野県', 36.247, 137.636), point('白馬駅', '長野県', 36.698, 137.862),
  point('八方尾根', '長野県', 36.7, 137.8), point('軽井沢駅', '長野県', 36.343, 138.635), point('野沢温泉', '長野県', 36.922, 138.444),
  point('高山駅', '岐阜県', 36.141, 137.251), point('白川郷', '岐阜県', 36.257, 136.906), point('熱海駅', '静岡県', 35.104, 139.077),
  point('名古屋駅', '愛知県', 35.171, 136.882), point('伊勢神宮（内宮）', '三重県', 34.455, 136.725), point('京都駅', '京都府', 34.985, 135.758),
  point('清水寺', '京都府', 34.995, 135.785), point('嵐山', '京都府', 35.009, 135.667), point('金閣寺', '京都府', 35.039, 135.729),
  point('大阪駅', '大阪府', 34.702, 135.495), point('道頓堀', '大阪府', 34.669, 135.501), point('奈良公園', '奈良県', 34.685, 135.843),
  point('広島駅', '広島県', 34.398, 132.475), point('宮島', '広島県', 34.296, 132.32), point('博多駅', '福岡県', 33.59, 130.421),
  point('別府駅', '大分県', 33.279, 131.5), point('由布院駅', '大分県', 33.263, 131.355), point('国際通り', '沖縄県', 26.215, 127.687),
  point('美ら海水族館', '沖縄県', 26.694, 127.878),
]
