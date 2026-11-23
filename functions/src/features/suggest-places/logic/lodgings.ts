import { CATALOGUE } from './catalogue'
import { CATALOGUE_EN } from '../../../domain/catalogueEnglish'

// 宿さがしの固定の応答（GEMINI_PROVIDER=stub）の見本。宿そのものの名前は書かず、泊まる所の多いエリアだけを並べる。
//
// - 実在の宿を手で書くと、営業していない宿や位置の違う宿を出すおそれがある。固定の応答ではエリアまでにし、
//   宿そのものは場所カードの「Google マップ」で選んでもらう（動いていない機能を、動いているように見せない）
// - エリアは 2 種類。見本の場所の一覧（catalogue.ts）の温泉地（「草津温泉の宿」）と、下の街の駅前（「松本駅周辺の宿」）
// - 街の位置は、このリポジトリで書いたおよその値（Maps から取ったものではない）。ピンを地図に置くためだけに使う
// - 本物の Gemini（agy、vertex）のときは使わない（実在する宿を頼む。prompt.ts）

export interface LodgingArea {
  /** 「草津温泉の宿」「松本駅周辺の宿」 */
  name: string
  nameEn?: string
  /** 都道府県（「長野県」） */
  pref: string
  /** 市町村（「松本市」） */
  city: string
  description: string
  descriptionEn?: string
  areaEn?: string
  lat: number
  lng: number
  /** 文の中で、このエリアに当たる言葉（「草津」「松本」） */
  words: string[]
  wordsEn?: string[]
}

type Town = [station: string, pref: string, city: string, lat: number, lng: number, stationEn: string, areaEn: string]

/** 県庁のある街と、旅の拠点になりやすい街の駅 */
const TOWNS: Town[] = [
  ['札幌', '北海道', '札幌市', 43.07, 141.35, 'Sapporo', 'Sapporo, Hokkaido'],
  ['函館', '北海道', '函館市', 41.77, 140.73, 'Hakodate', 'Hakodate, Hokkaido'],
  ['旭川', '北海道', '旭川市', 43.76, 142.36, 'Asahikawa', 'Asahikawa, Hokkaido'],
  ['釧路', '北海道', '釧路市', 42.99, 144.38, 'Kushiro', 'Kushiro, Hokkaido'],
  ['青森', '青森県', '青森市', 40.83, 140.73, 'Aomori', 'Aomori, Aomori'],
  ['盛岡', '岩手県', '盛岡市', 39.7, 141.14, 'Morioka', 'Morioka, Iwate'],
  ['仙台', '宮城県', '仙台市', 38.26, 140.88, 'Sendai', 'Sendai, Miyagi'],
  ['秋田', '秋田県', '秋田市', 39.72, 140.13, 'Akita', 'Akita, Akita'],
  ['山形', '山形県', '山形市', 38.25, 140.33, 'Yamagata', 'Yamagata, Yamagata'],
  ['福島', '福島県', '福島市', 37.75, 140.46, 'Fukushima', 'Fukushima, Fukushima'],
  ['会津若松', '福島県', '会津若松市', 37.51, 139.93, 'Aizu-Wakamatsu', 'Aizu-Wakamatsu, Fukushima'],
  ['水戸', '茨城県', '水戸市', 36.37, 140.48, 'Mito', 'Mito, Ibaraki'],
  ['宇都宮', '栃木県', '宇都宮市', 36.56, 139.9, 'Utsunomiya', 'Utsunomiya, Tochigi'],
  ['高崎', '群馬県', '高崎市', 36.32, 139.01, 'Takasaki', 'Takasaki, Gunma'],
  ['大宮', '埼玉県', 'さいたま市', 35.91, 139.62, 'Omiya', 'Saitama, Saitama'],
  ['千葉', '千葉県', '千葉市', 35.61, 140.11, 'Chiba', 'Chiba, Chiba'],
  ['東京', '東京都', '千代田区', 35.68, 139.77, 'Tokyo', 'Chiyoda, Tokyo'],
  ['横浜', '神奈川県', '横浜市', 35.47, 139.62, 'Yokohama', 'Yokohama, Kanagawa'],
  ['新潟', '新潟県', '新潟市', 37.91, 139.06, 'Niigata', 'Niigata, Niigata'],
  ['富山', '富山県', '富山市', 36.7, 137.21, 'Toyama', 'Toyama, Toyama'],
  ['金沢', '石川県', '金沢市', 36.58, 136.65, 'Kanazawa', 'Kanazawa, Ishikawa'],
  ['福井', '福井県', '福井市', 36.06, 136.22, 'Fukui', 'Fukui, Fukui'],
  ['甲府', '山梨県', '甲府市', 35.67, 138.57, 'Kofu', 'Kofu, Yamanashi'],
  ['長野', '長野県', '長野市', 36.64, 138.19, 'Nagano', 'Nagano, Nagano'],
  ['松本', '長野県', '松本市', 36.23, 137.97, 'Matsumoto', 'Matsumoto, Nagano'],
  ['軽井沢', '長野県', '軽井沢町', 36.34, 138.63, 'Karuizawa', 'Karuizawa, Nagano'],
  ['岐阜', '岐阜県', '岐阜市', 35.41, 136.76, 'Gifu', 'Gifu, Gifu'],
  ['高山', '岐阜県', '高山市', 36.14, 137.25, 'Takayama', 'Takayama, Gifu'],
  ['静岡', '静岡県', '静岡市', 34.97, 138.39, 'Shizuoka', 'Shizuoka, Shizuoka'],
  ['浜松', '静岡県', '浜松市', 34.7, 137.73, 'Hamamatsu', 'Hamamatsu, Shizuoka'],
  ['名古屋', '愛知県', '名古屋市', 35.17, 136.88, 'Nagoya', 'Nagoya, Aichi'],
  ['津', '三重県', '津市', 34.73, 136.51, 'Tsu', 'Tsu, Mie'],
  ['伊勢市', '三重県', '伊勢市', 34.49, 136.71, 'Iseshi', 'Ise, Mie'],
  ['大津', '滋賀県', '大津市', 35.0, 135.86, 'Otsu', 'Otsu, Shiga'],
  ['京都', '京都府', '京都市', 34.99, 135.76, 'Kyoto', 'Kyoto, Kyoto'],
  ['大阪', '大阪府', '大阪市', 34.7, 135.5, 'Osaka', 'Osaka, Osaka'],
  ['三ノ宮', '兵庫県', '神戸市', 34.69, 135.2, 'Sannomiya', 'Kobe, Hyogo'],
  ['姫路', '兵庫県', '姫路市', 34.83, 134.69, 'Himeji', 'Himeji, Hyogo'],
  ['奈良', '奈良県', '奈良市', 34.68, 135.82, 'Nara', 'Nara, Nara'],
  ['和歌山', '和歌山県', '和歌山市', 34.23, 135.19, 'Wakayama', 'Wakayama, Wakayama'],
  ['鳥取', '鳥取県', '鳥取市', 35.49, 134.23, 'Tottori', 'Tottori, Tottori'],
  ['松江', '島根県', '松江市', 35.46, 133.06, 'Matsue', 'Matsue, Shimane'],
  ['岡山', '岡山県', '岡山市', 34.67, 133.92, 'Okayama', 'Okayama, Okayama'],
  ['広島', '広島県', '広島市', 34.4, 132.48, 'Hiroshima', 'Hiroshima, Hiroshima'],
  ['山口', '山口県', '山口市', 34.17, 131.48, 'Yamaguchi', 'Yamaguchi, Yamaguchi'],
  ['下関', '山口県', '下関市', 33.95, 130.92, 'Shimonoseki', 'Shimonoseki, Yamaguchi'],
  ['徳島', '徳島県', '徳島市', 34.07, 134.55, 'Tokushima', 'Tokushima, Tokushima'],
  ['高松', '香川県', '高松市', 34.35, 134.05, 'Takamatsu', 'Takamatsu, Kagawa'],
  ['松山', '愛媛県', '松山市', 33.84, 132.75, 'Matsuyama', 'Matsuyama, Ehime'],
  ['高知', '高知県', '高知市', 33.57, 133.54, 'Kochi', 'Kochi, Kochi'],
  ['博多', '福岡県', '福岡市', 33.59, 130.42, 'Hakata', 'Fukuoka, Fukuoka'],
  ['佐賀', '佐賀県', '佐賀市', 33.26, 130.3, 'Saga', 'Saga, Saga'],
  ['長崎', '長崎県', '長崎市', 32.75, 129.87, 'Nagasaki', 'Nagasaki, Nagasaki'],
  ['熊本', '熊本県', '熊本市', 32.79, 130.69, 'Kumamoto', 'Kumamoto, Kumamoto'],
  ['大分', '大分県', '大分市', 33.23, 131.61, 'Oita', 'Oita, Oita'],
  ['宮崎', '宮崎県', '宮崎市', 31.92, 131.43, 'Miyazaki', 'Miyazaki, Miyazaki'],
  ['鹿児島中央', '鹿児島県', '鹿児島市', 31.58, 130.54, 'Kagoshima-Chuo', 'Kagoshima, Kagoshima'],
  ['那覇', '沖縄県', '那覇市', 26.21, 127.68, 'Naha', 'Naha, Okinawa'],
  ['石垣', '沖縄県', '石垣市', 24.34, 124.16, 'Ishigaki', 'Ishigaki, Okinawa'],
]

/** 泊まる所の多いエリア。温泉地を先に、そのあと街の駅前 */
export const LODGING_AREAS: LodgingArea[] = [
  ...CATALOGUE.filter((entry) => entry.category === 'onsen').map((entry) => {
    const english = CATALOGUE_EN[entry.name]
    return {
      name: `${entry.name}の宿`,
      pref: entry.pref,
      city: entry.city,
      description: '温泉街のエリア。宿は Google マップで選べます',
      lat: entry.lat,
      lng: entry.lng,
      words: [entry.name, ...(entry.tags ?? []).filter((tag) => tag.length >= 2)],
      ...(english ? {
        nameEn: `Stays near ${english[0]}`,
        descriptionEn: 'Hot spring area. Choose a place to stay on Google Maps.',
        areaEn: english[1],
        wordsEn: [english[0].replace(/ Onsen$/, '')],
      } : {}),
    }
  }),
  ...TOWNS.map(([station, pref, city, lat, lng, stationEn, areaEn]) => ({
    // 石垣には駅がないので、街の名前で出す
    name: station === '石垣' ? '石垣市街の宿' : `${station}駅周辺の宿`,
    nameEn: station === '石垣' ? 'Stays in central Ishigaki' : `Stays near ${stationEn} Station`,
    pref,
    city,
    description: station === '石垣' ? '港に近い街のエリア。宿は Google マップで選べます' : '駅に近いエリア。宿は Google マップで選べます',
    descriptionEn: station === '石垣'
      ? 'Area near the harbor. Choose a place to stay on Google Maps.'
      : 'Area near the station. Choose a place to stay on Google Maps.',
    areaEn,
    lat,
    lng,
    words: [station.replace(/市$/, '')],
    wordsEn: [stationEn, areaEn.split(', ')[0]],
  })),
]

/**
 * ごはんのお店さがし（しおりのごはんの枠の「お店を探す」）の固定の応答の見本。宿と同じく、お店そのものの名前は書かない。
 * 見本の場所の一覧の食べものの場所（「戸隠そば」）と、街の駅前（「松本駅周辺のお店」）。お店は場所カードの「Google マップ」で選んでもらう
 */
export const MEAL_AREAS: LodgingArea[] = [
  ...CATALOGUE.filter((entry) => entry.category === 'food').map((entry) => {
    const english = CATALOGUE_EN[entry.name]
    return {
      name: entry.name,
      pref: entry.pref,
      city: entry.city,
      description: entry.description,
      lat: entry.lat,
      lng: entry.lng,
      words: [entry.name, ...(entry.tags ?? []).filter((tag) => tag.length >= 2)],
      ...(english ? { nameEn: english[0], areaEn: english[1], descriptionEn: english[2], wordsEn: [english[0]] } : {}),
    }
  }),
  ...TOWNS.map(([station, pref, city, lat, lng, stationEn, areaEn]) => ({
    name: station === '石垣' ? '石垣市街のお店' : `${station}駅周辺のお店`,
    nameEn: station === '石垣' ? 'Restaurants in central Ishigaki' : `Restaurants near ${stationEn} Station`,
    pref,
    city,
    description: station === '石垣' ? '港に近い街のエリア。お店は Google マップで選べます' : '駅に近いエリア。お店は Google マップで選べます',
    descriptionEn: station === '石垣'
      ? 'Area near the harbor. Choose a restaurant on Google Maps.'
      : 'Area near the station. Choose a restaurant on Google Maps.',
    areaEn,
    lat,
    lng,
    words: [station.replace(/市$/, '')],
    wordsEn: [stationEn, areaEn.split(', ')[0]],
  })),
]
