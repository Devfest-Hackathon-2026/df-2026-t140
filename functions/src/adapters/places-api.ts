import type { LatLng } from '../domain/pin'
import { countApiCall } from './apiUsage'
import type { FoundLodging, FoundPlace, PlacePhoto, PlaceReview, PlaceReviews, PlacesApiPort, ReviewsLanguage } from '../ports/places-api'

// Google の Places API（New）のテキスト検索で、建てる場所が実在するかと、その位置を聞く。
// かめの決定（todo/humans/2026-11-08-places-verify-suggestions.md の C）：「建築する！」を押した場所だけ、1 か所 1 回。
// 本番だけで使い、開発環境では使わない。本番でも、建てた人が合言葉を通しているか、全員に開く切り替えが入っているときだけ
// （呼ぶかどうかは features/verify-place/usecase.ts が決める）。
//
// - キーは環境変数 PLACES_API_KEY（本番は人が GitHub の secret に入れ、Deploy が関数の環境に渡す。リポジトリには書かない）
// - Emulator（FUNCTIONS_EMULATOR=true）では、キーがあっても呼ばない
// - 受け取るのは place_id と位置だけ（X-Goog-FieldMask）。名前や住所、写真は受け取らない。
//   宿さがしの候補の確かめ（findLodging。features/suggest-places が呼ぶ）だけは、宿かどうかを見るため種類も、車の旅では駐車場も受け取る（ふるうのに使うだけで保存しない）
// - 1 日の回数は、Google Cloud の Places API（テキスト検索）の上限（今は 150 回）で止まる。止まったら呼び出しは失敗し、位置はそのまま
// - 結果は 3D 生成の入力に使わない（規約 3.2.3(c)）。ピンの位置と placeId を直すことにだけ使う

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
/** 待つ長さ（ms）。ピンが「工事中」のあいだに終わる長さにする */
const TIMEOUT_MS = 10_000
/** 推測した位置のまわりを優先する半径（m）。Places の決まりで 50 km まで */
export const BIAS_RADIUS_M = 50_000

/** searchText に送る中身（テストのために export する） */
export function placesRequestBody(text: string, near?: LatLng) {
  return {
    textQuery: text,
    languageCode: 'ja',
    regionCode: 'JP',
    pageSize: 1,
    ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M } } } : {}),
  }
}

/** searchText の応答から、最初の 1 件の place_id と位置を取り出す（テストのために export する）。読めなければ null */
export function parseFoundPlace(json: unknown): FoundPlace | null {
  const places = (json as { places?: unknown })?.places
  if (!Array.isArray(places) || places.length === 0) return null
  const first = places[0] as { id?: unknown; location?: { latitude?: unknown; longitude?: unknown } }
  const lat = first?.location?.latitude
  const lng = first?.location?.longitude
  if (typeof first?.id !== 'string' || first.id.length === 0) return null
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { placeId: first.id, location: { lat, lng } }
}

/** 宿の種類（Places API（New）の Table A の Lodging）。どれかがあれば宿とみなす */
export const LODGING_TYPES = [
  'bed_and_breakfast', 'budget_japanese_inn', 'campground', 'camping_cabin', 'cottage', 'extended_stay_hotel', 'farmstay', 'guest_house',
  'hostel', 'hotel', 'inn', 'japanese_inn', 'lodging', 'motel', 'private_guest_room', 'resort_hotel',
] as const
const RYOKAN_TYPES = ['japanese_inn', 'budget_japanese_inn']
const PARKING_FIELDS = ['freeParkingLot', 'paidParkingLot', 'freeStreetParking', 'paidStreetParking', 'valetParking', 'freeGarageParking', 'paidGarageParking']

/** searchText（宿の確かめ）の応答から、最初の 1 件の位置、種類、駐車場を取り出す（テストのために export する）。読めなければ null */
export function parseFoundLodging(json: unknown): FoundLodging | null {
  const found = parseFoundPlace(json)
  if (!found) return null
  const first = (json as { places: { types?: unknown; parkingOptions?: unknown }[] }).places[0]
  const types = Array.isArray(first.types) ? first.types.filter((type): type is string => typeof type === 'string') : []
  const options = first.parkingOptions && typeof first.parkingOptions === 'object' ? (first.parkingOptions as Record<string, unknown>) : null
  const answers = options ? PARKING_FIELDS.map((field) => options[field]).filter((value): value is boolean => typeof value === 'boolean') : []
  return {
    ...found,
    lodging: types.some((type) => (LODGING_TYPES as readonly string[]).includes(type)),
    ryokan: types.some((type) => RYOKAN_TYPES.includes(type)),
    parking: answers.length === 0 ? null : answers.some(Boolean),
  }
}

/** searchText（ID だけ）の応答から、最初の 1 件の place_id を取り出す（テストのために export する）。読めなければ null */
export function parseFoundPlaceId(json: unknown): string | null {
  const places = (json as { places?: unknown })?.places
  if (!Array.isArray(places) || places.length === 0) return null
  const id = (places[0] as { id?: unknown })?.id
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,300}$/.test(id) ? id : null
}

/** 口コミを出してよい設定か。キーに加えて PLACES_REVIEWS=on が要る（人が決めるまでは off） */
export function placesReviewsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return placesApiEnabled(env) && env.PLACES_REVIEWS === 'on'
}

/**
 * 写真を出してよい設定か。口コミを出せる設定に加えて PLACES_PHOTOS=on が要る。
 * 写真は Place Photo の別の料金の区分（1 日の上限は 2026-11-08 に 0 回から 30 回、2026-11-23 に 100 回に上げた）なので、人が上限を上げてから on にする
 * （かめの決定 todo/humans/2026-11-07-places-photos-reviews.md。保存はしない）
 */
export function placesPhotosEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return placesReviewsEnabled(env) && env.PLACES_PHOTOS === 'on'
}

/** 写真の横幅（px）。シートの幅（スマホ）に足りる大きさ */
export const PHOTO_MAX_WIDTH_PX = 800

/** Place Details の応答から、1 枚目の写真の名前と撮った人を取り出す（テストのために export する）。なければ null */
export function parseFirstPhoto(json: unknown): { name: string; authors: PlacePhoto['authors'] } | null {
  const photos = (json as { photos?: unknown } | null)?.photos
  if (!Array.isArray(photos) || photos.length === 0) return null
  const first = photos[0] as { name?: unknown; authorAttributions?: unknown }
  if (typeof first?.name !== 'string' || !/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(first.name)) return null
  const list = Array.isArray(first.authorAttributions) ? first.authorAttributions : []
  const authors = list.flatMap((raw) => {
    const item = raw as { displayName?: unknown; uri?: unknown }
    return typeof item?.displayName === 'string' && item.displayName.trim() ? [{ name: item.displayName.trim(), uri: httpsOrNull(item.uri) }] : []
  })
  return { name: first.name, authors }
}

/** Place Photo（skipHttpRedirect）の応答から、画像の URL を取り出す（テストのために export する）。なければ null */
export function parsePhotoUri(json: unknown): string | null {
  return httpsOrNull((json as { photoUri?: unknown } | null)?.photoUri)
}

/**
 * 口コミと写真を聞く Place Details の URL（テストのために export する）。言語は 'en' のときだけ英語、ほかは日本語。
 * 英語のとき、Places は口コミの本文を英語に訳して text に入れ、元の文を originalText に入れる（parseReviews は text を先に読む）
 */
export function placeDetailsUrl(placeId: string, language?: ReviewsLanguage): string {
  return `https://places.googleapis.com/v1/places/${placeId}?languageCode=${language === 'en' ? 'en' : 'ja'}`
}

/** 口コミの数の上限（Places API が返すのも 5 件まで） */
export const MAX_REVIEWS = 5

const httpsOrNull = (value: unknown): string | null => (typeof value === 'string' && /^https:\/\//.test(value) ? value : null)

/** 場所の公式サイトの URL。http のままのサイトもあるので、http と https を通す（ほかの形は捨てる） */
const webOrNull = (value: unknown): string | null => (typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value) && value.length <= 2048 ? value : null)

/** Place Details の応答から、口コミを取り出す（テストのために export する）。本文と投稿者の名前がないものは除く */
export function parseReviews(json: unknown): PlaceReviews {
  const body = json as { reviews?: unknown; googleMapsUri?: unknown; websiteUri?: unknown } | null
  const list = Array.isArray(body?.reviews) ? body.reviews : []
  const reviews: PlaceReview[] = []
  for (const raw of list) {
    const item = raw as {
      text?: { text?: unknown }
      originalText?: { text?: unknown }
      rating?: unknown
      relativePublishTimeDescription?: unknown
      authorAttribution?: { displayName?: unknown; uri?: unknown; photoUri?: unknown }
      googleMapsUri?: unknown
      flagContentUri?: unknown
    }
    const text = typeof item?.text?.text === 'string' ? item.text.text : typeof item?.originalText?.text === 'string' ? item.originalText.text : ''
    const author = typeof item?.authorAttribution?.displayName === 'string' ? item.authorAttribution.displayName : ''
    if (!text.trim() || !author.trim()) continue
    reviews.push({
      author,
      authorUri: httpsOrNull(item.authorAttribution?.uri),
      authorPhotoUri: httpsOrNull(item.authorAttribution?.photoUri),
      rating: typeof item.rating === 'number' && item.rating >= 1 && item.rating <= 5 ? item.rating : null,
      text: text.trim(),
      relativeTime: typeof item.relativePublishTimeDescription === 'string' ? item.relativePublishTimeDescription : '',
      mapsUri: httpsOrNull(item.googleMapsUri),
      flagUri: httpsOrNull(item.flagContentUri),
    })
    if (reviews.length >= MAX_REVIEWS) break
  }
  return { reviews, placeUri: httpsOrNull(body?.googleMapsUri), photo: null, website: webOrNull(body?.websiteUri) }
}

/** Emulator ではなく、キーがあるか */
export function placesApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR !== 'true' && (env.PLACES_API_KEY ?? '').trim().length > 0
}

/**
 * 写真の画像の URL を聞く（Place Photo。skipHttpRedirect で、キーを含まない画像の URL だけを受け取る）。
 * 取れなければ null（写真なしで口コミだけ出す）。画像も URL も保存しない
 */
async function photoOf(first: { name: string; authors: PlacePhoto['authors'] }, key: string): Promise<PlacePhoto | null> {
  try {
    await countApiCall('placesPhoto')
    const response = await fetch(`https://places.googleapis.com/v1/${first.name}/media?maxWidthPx=${PHOTO_MAX_WIDTH_PX}&skipHttpRedirect=true`, {
      headers: { 'X-Goog-Api-Key': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      console.warn(`Places API（写真）が ${response.status} を返しました`)
      return null
    }
    const uri = parsePhotoUri(await response.json())
    return uri ? { uri, authors: first.authors } : null
  } catch (cause) {
    console.warn('Places API（写真）を呼べませんでした', cause)
    return null
  }
}

/** 開発環境（Emulator）か。口コミと写真を、Places を呼ばずに見本で返す */
export function placesSampleMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === 'true'
}

export const placesApi: PlacesApiPort = {
  enabled: () => placesApiEnabled(),
  sampleMode: () => placesSampleMode(),
  reviewsEnabled: () => placesReviewsEnabled(),
  async reviews(placeId, options = {}) {
    const key = process.env.PLACES_API_KEY?.trim()
    if (!placesReviewsEnabled() || !key || !/^[A-Za-z0-9_-]{1,300}$/.test(placeId)) return null
    // 写真は、写真を出す設定があり、呼ぶ側が写真を使うとき（場所の情報 S12）だけ。候補の場所カードでは取らない
    const withPhoto = placesPhotosEnabled() && options.photo !== false
    try {
      await countApiCall('placesDetails')
      const response = await fetch(placeDetailsUrl(placeId, options.language), {
        headers: {
          'X-Goog-Api-Key': key,
          // 口コミと、場所を Google マップで開く URL と、公式サイトの URL だけ（Enterprise + Atmosphere の区分。ほかの項目は受け取らない）。
          // 公式サイト（websiteUri）は Enterprise の区分なので、足しても口コミの区分のまま、料金は変わらない（宿の場所の情報のリンク。#705）。
          // 写真を出す設定なら、写真の名前と撮った人も受け取る（同じ区分の中。画像は下の Place Photo で別に取る）
          'X-Goog-FieldMask': withPhoto ? 'reviews,googleMapsUri,websiteUri,photos' : 'reviews,googleMapsUri,websiteUri',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`Places API（口コミ）が ${response.status} を返しました`)
        return null
      }
      const json = await response.json()
      const found = parseReviews(json)
      const first = withPhoto ? parseFirstPhoto(json) : null
      return first ? { ...found, photo: await photoOf(first, key) } : found
    } catch (cause) {
      console.warn('Places API（口コミ）を呼べませんでした', cause)
      return null
    }
  },
  async findPlaceId({ text, near }) {
    const key = process.env.PLACES_API_KEY?.trim()
    if (!placesApiEnabled() || !key || text.trim().length === 0) return null
    try {
      await countApiCall('placesSearch')
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          // 場所の ID だけを受け取る（Text Search Essentials (IDs Only)。上限なく無料）。位置も名前も受け取らない
          'X-Goog-FieldMask': 'places.id',
        },
        body: JSON.stringify(placesRequestBody(text, near)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`Places API（ID だけの検索）が ${response.status} を返しました`)
        return null
      }
      return parseFoundPlaceId(await response.json())
    } catch (cause) {
      console.warn('Places API（ID だけの検索）を呼べませんでした', cause)
      return null
    }
  },
  async findLodging({ text, near, parking }) {
    const key = process.env.PLACES_API_KEY?.trim()
    if (!placesApiEnabled() || !key || text.trim().length === 0) return null
    try {
      await countApiCall('placesSearch')
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          // 駐車場（parkingOptions）は料金の区分が上がるので、車の旅のときだけ聞く
          'X-Goog-FieldMask': parking ? 'places.id,places.location,places.types,places.parkingOptions' : 'places.id,places.location,places.types',
        },
        body: JSON.stringify(placesRequestBody(text, near)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`Places API（宿の確かめ）が ${response.status} を返しました`)
        return null
      }
      return parseFoundLodging(await response.json()) ?? 'not-found'
    } catch (cause) {
      console.warn('Places API（宿の確かめ）を呼べませんでした', cause)
      return null
    }
  },
  async findPlace({ text, near }) {
    const key = process.env.PLACES_API_KEY?.trim()
    if (!placesApiEnabled() || !key || text.trim().length === 0) return null
    try {
      await countApiCall('placesSearch')
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          // place_id と位置だけを受け取る
          'X-Goog-FieldMask': 'places.id,places.location',
        },
        body: JSON.stringify(placesRequestBody(text, near)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`Places API が ${response.status} を返しました。位置はそのままにします`)
        return null
      }
      return parseFoundPlace(await response.json())
    } catch (cause) {
      console.warn('Places API を呼べませんでした。位置はそのままにします', cause)
      return null
    }
  },
}
