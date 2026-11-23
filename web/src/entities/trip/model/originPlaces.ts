// 出発地の名前（「東京駅」「大阪」）から、およその位置を引く表。しおりで集合場所の印を地図に出し、そこへ寄るのに使う（#226）。
// Functions の functions/src/domain/originPlaces.ts と同じ表（しおりの移動時間の見積もりに使っている）。片方を変えたら、同じ PR でもう片方も変える。
// 位置は、このリポジトリで書いたおよその値（Maps から取ったものではない）。表にない名前は、位置が分からない扱いにする。

import { stationLocation } from './stations.ts'
import { translate as t } from '../../../shared/lib/language.ts'

/** すぐ選べる出発地。英語名の照合は Functions の originPlaces.ts と合わせる */
const SHORTCUT_NAMES: ReadonlyMap<string, string> = new Map([
  ['東京駅', 'Tokyo Station'],
  ['新宿駅', 'Shinjuku Station'],
  ['渋谷駅', 'Shibuya Station'],
  ['品川駅', 'Shinagawa Station'],
  ['横浜駅', 'Yokohama Station'],
  ['名古屋駅', 'Nagoya Station'],
  ['京都駅', 'Kyoto Station'],
  ['大阪駅', 'Osaka Station'],
  ['博多駅', 'Hakata Station'],
])

const ENGLISH_STATIONS = new Map([...SHORTCUT_NAMES].map(([ja, en]) => [en.toLowerCase().replace(/ station$/, ''), ja]))

export function originDisplayName(name: string): string {
  return t(name, SHORTCUT_NAMES.get(name) ?? name)
}

const PLACES: readonly [name: string, lat: number, lng: number][] = [
  // 駅や空港の名前を、街の名前より先に見る（「新大阪」を「大阪」より先に）
  ['新大阪', 34.73, 135.5],
  ['新横浜', 35.51, 139.62],
  ['羽田', 35.55, 139.78],
  ['成田', 35.77, 140.39],
  ['新宿', 35.69, 139.7],
  ['目黒', 35.6339, 139.7158],
  ['めぐろ', 35.6339, 139.7158],
  ['渋谷', 35.66, 139.7],
  ['品川', 35.63, 139.74],
  ['上野', 35.71, 139.78],
  ['池袋', 35.73, 139.71],
  ['梅田', 34.7, 135.5],
  ['難波', 34.67, 135.5],
  ['三宮', 34.69, 135.2],
  ['三ノ宮', 34.69, 135.2],
  ['博多', 33.59, 130.42],
  ['大宮', 35.91, 139.62],
  ['立川', 35.7, 139.41],
  ['八王子', 35.66, 139.34],
  ['東京', 35.68, 139.77],
  ['横浜', 35.47, 139.62],
  ['千葉', 35.61, 140.11],
  ['さいたま', 35.86, 139.65],
  ['川崎', 35.53, 139.7],
  ['札幌', 43.07, 141.35],
  ['函館', 41.77, 140.73],
  ['旭川', 43.76, 142.36],
  ['青森', 40.83, 140.73],
  ['盛岡', 39.7, 141.14],
  ['仙台', 38.26, 140.88],
  ['秋田', 39.72, 140.13],
  ['山形', 38.25, 140.33],
  ['福島', 37.75, 140.46],
  ['郡山', 37.4, 140.39],
  ['水戸', 36.37, 140.48],
  ['宇都宮', 36.56, 139.9],
  ['前橋', 36.38, 139.07],
  ['高崎', 36.32, 139.01],
  ['新潟', 37.91, 139.06],
  ['富山', 36.7, 137.21],
  ['金沢', 36.58, 136.65],
  ['福井', 36.06, 136.22],
  ['甲府', 35.67, 138.57],
  ['長野', 36.64, 138.19],
  ['松本', 36.23, 137.97],
  ['岐阜', 35.41, 136.76],
  ['静岡', 34.97, 138.39],
  ['浜松', 34.7, 137.73],
  ['名古屋', 35.17, 136.88],
  ['津', 34.73, 136.51],
  ['大津', 35.0, 135.86],
  ['京都', 34.99, 135.76],
  ['大阪', 34.7, 135.5],
  ['神戸', 34.69, 135.19],
  ['姫路', 34.83, 134.69],
  ['奈良', 34.68, 135.82],
  ['和歌山', 34.23, 135.19],
  ['鳥取', 35.49, 134.23],
  ['松江', 35.46, 133.06],
  ['岡山', 34.67, 133.92],
  ['広島', 34.4, 132.48],
  ['山口', 34.17, 131.47],
  ['下関', 33.95, 130.92],
  ['徳島', 34.07, 134.55],
  ['高松', 34.35, 134.05],
  ['松山', 33.84, 132.75],
  ['高知', 33.57, 133.54],
  ['北九州', 33.89, 130.88],
  ['小倉', 33.89, 130.88],
  ['福岡', 33.59, 130.42],
  ['佐賀', 33.26, 130.3],
  ['長崎', 32.75, 129.87],
  ['熊本', 32.79, 130.69],
  ['大分', 33.23, 131.61],
  ['宮崎', 31.92, 131.43],
  ['鹿児島', 31.58, 130.54],
  ['那覇', 26.21, 127.68],
  ['沖縄', 26.21, 127.68],
]

/** 出発地の名前から、およその位置を引く。分からなければ null */
export function originLocation(name: string): { lat: number; lng: number } | null {
  return originLocationWith(name, stationLocation)
}

/**
 * 出発地の名前から位置を引く順番（Functions の resolveOrigin と同じ順）。
 * 1. この表と名前がちょうど同じ（「福岡」「博多駅」「羽田空港」）。同じ名前の遠くの駅（富山の福岡駅など）に当たらないように、駅の表より先に見る
 * 2. 全国の駅の表（「浜田山駅」など。station に渡す。画面では表を読み込んだあとだけ当たる。model/stations.ts）
 * 3. この表の名前を含む（「新大阪駅の改札」）。「津」のような 1 文字の名前は、ほかの言葉に紛れるので、名前の先頭にあるときだけ当てる
 */
export function originLocationWith(
  name: string,
  station: (name: string) => { lat: number; lng: number } | null,
): { lat: number; lng: number } | null {
  const input = name.normalize('NFKC').trim()
  const stationName = input.toLowerCase().replace(/ station$/, '')
  const normalized = ENGLISH_STATIONS.get(stationName) ?? input
  const exact = PLACES.find(([key]) => [key, `${key}駅`, `${key}空港`].includes(normalized))
  if (exact) return { lat: exact[1], lng: exact[2] }
  const onLine = station(normalized)
  if (onLine) return onLine
  const found = PLACES.find(([key]) => (key.length === 1 ? name.startsWith(key) : name.includes(key)))
  return found ? { lat: found[1], lng: found[2] } : null
}
