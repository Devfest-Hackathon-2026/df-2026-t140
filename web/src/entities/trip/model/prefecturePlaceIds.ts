import { REGION_PREFECTURES, type RegionId } from './regions'

// 都道府県の Google の場所の ID。地図の境界の層（Google の県境）で地方を塗るときに、県を見分けるのに使う（#373）。
// 境界の層をオンにしたあと（todo/humans/2026-11-16-boundary-layer.md）、開発の地図で各県の中を押して集めた
// （2026-11-16。押すと、widgets/trip-map の GoogleSurface.tsx がコンソールに「[boundary] 場所の ID 緯度 経度」を出す）。
// Places API は呼んでいない。47 県とも別の ID であることを確かめた。1 つでも欠けた地方は、自前の地方の形（regionShapes）で塗る。
export const PREFECTURE_PLACE_IDS: Partial<Record<string, string>> = {
  北海道: 'ChIJi4hsnyBZn18RjwPOT1bDPBw',
  青森県: 'ChIJR60vIL2bm18Ro_kApp-uBak',
  岩手県: 'ChIJIzoJ7dCQhV8RbEB_6H6BLGY',
  宮城県: 'ChIJcdzg-92SiF8RraQHUTi5b84',
  秋田県: 'ChIJv_Eu0V7rj18REhxcYOz7fZo',
  山形県: 'ChIJbeLoh3fsi18RXo9kabDE3OY',
  福島県: 'ChIJL9XcbYEEIGARXEbW0MGmHzQ',
  茨城県: 'ChIJF8In71sYImARgMV4m4P7Spo',
  栃木県: 'ChIJ7RWXa1VwH2ARB9AguZ5FZW0',
  群馬県: 'ChIJWa42yIVgHmARknJxiWg1mdc',
  埼玉県: 'ChIJ6QF7R40qGWARbFKAqmcS2f4',
  千葉県: 'ChIJEZUb1l-bImARvnvg_9t3thw',
  東京都: 'ChIJ51cu8IcbXWARiRtXIothAS4',
  神奈川県: 'ChIJq9Rn-8dUGGARViMnQtCc9xE',
  新潟県: 'ChIJATtK2PaFjF8RSPPdfITZi7Q',
  富山県: 'ChIJSca2CRSS918Rc1GBWMBBk3w',
  石川県: 'ChIJ7xq8wV5-8V8RtJoYjRM81Es',
  福井県: 'ChIJEb6scKhV_18RYA7nHjFfIQo',
  山梨県: 'ChIJIe5Ck3LjG2ARqm6fj-ToBHM',
  長野県: 'ChIJa4zJGCMBHWARlAu_BE8rXAI',
  岐阜県: 'ChIJi8OICvLxAmARZ9bM7q0UJ68',
  静岡県: 'ChIJL8OwjM62G2ARVRZv3-tm-vw',
  愛知県: 'ChIJ5zKTSdW6BGARp0EVGF2mX-s',
  三重県: 'ChIJY0FHSvU9BGARKIc4ff5ynkI',
  滋賀県: 'ChIJfRcKhFR_AWAR0Ih82zbkEkQ',
  京都府: 'ChIJYRsf-SB0_18ROJWxOMJ7Clk',
  大阪府: 'ChIJ13DMKmvoAGARbVkfgUj_maM',
  兵庫県: 'ChIJoa4nX2HyVDURoQquLKTzHh8',
  奈良県: 'ChIJ0yeFNyrHBmARcsHp9gNgR-o',
  和歌山県: 'ChIJ1wKhtPIEB2ARnU_gb_EzSNQ',
  鳥取県: 'ChIJB0-MsELXVTUR7pLgQAxBLzs',
  島根県: 'ChIJocsETn0DWzURzBYpE2fXNC0',
  岡山県: 'ChIJh5W24jhmVDURU20vGB0GIdI',
  広島県: 'ChIJa_O3GdGJUDURv90VFtIkjqU',
  山口県: 'ChIJ_Y9adhnHRDURcOJUU8K8DEk',
  徳島県: 'ChIJszfXrltNUjURDDHPZPlj3f0',
  香川県: 'ChIJr363rNTcUzURsdqbibLWgS0',
  愛媛県: 'ChIJraqWR5CVTzUR272f78CTlP8',
  高知県: 'ChIJa2Hq0TSpSDURow2-nqQtVKA',
  福岡県: 'ChIJJbF-93qBQTURTThRSvsPopc',
  佐賀県: 'ChIJVVXx4qHSQTUR2vEeH2zUCzA',
  長崎県: 'ChIJC46vsRChaTURlUoIqR4qlSQ',
  熊本県: 'ChIJpzy0q613QDUR8fFMMDKVF_I',
  大分県: 'ChIJk0fY45VcRDUR4r42cPK3Fz8',
  宮崎県: 'ChIJYfx_FietODURKhlreMr3-Cg',
  鹿児島県: 'ChIJA4AW0cJbGDURcNZa6PLRr40',
  沖縄県: 'ChIJ51ur7mJw9TQR79H9hnJhuzU',
}

/** その地方の県と、その場所の ID。1 つでも分からない県があれば undefined（自前の形で塗る） */
export function regionPrefecturePlaces(id: RegionId): { prefecture: string; placeId: string }[] | undefined {
  const places = REGION_PREFECTURES[id].map((prefecture) => ({ prefecture, placeId: PREFECTURE_PLACE_IDS[prefecture] }))
  return places.every((place): place is { prefecture: string; placeId: string } => Boolean(place.placeId)) ? places : undefined
}
