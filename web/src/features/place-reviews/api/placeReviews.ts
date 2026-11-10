import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/** Google マップの口コミ 1 件（functions/src/ports/places-api.ts と同じ形）。画面に出すだけで、どこにも保存しない */
export interface PlaceReview {
  author: string
  authorUri: string | null
  authorPhotoUri: string | null
  rating: number | null
  text: string
  relativeTime: string
  mapsUri: string | null
  flagUri: string | null
}

/** Google マップの写真 1 枚（functions/src/ports/places-api.ts と同じ形）。画面に出すだけで、どこにも保存しない */
export interface PlacePhoto {
  uri: string
  authors: { name: string; uri: string | null }[]
}

export interface PlaceReviews {
  reviews: PlaceReview[]
  placeUri: string | null
  /** 写真を出す設定がない、写真がない、取れなかったときは null */
  photo: PlacePhoto | null
  /** 開発環境の見本か（Google マップの口コミ・写真ではない）。Google マップの出典を出さない */
  sample: boolean
}

type Answer = ({ status: 'reviews' } & PlaceReviews) | { status: 'unavailable' }

/**
 * 場所の口コミと写真 1 枚を Functions に聞く（functions/src/features/place-reviews）。
 * 出せないとき（人が決める前、合言葉を通していない、確かめていない場所、開発環境）は null
 */
export async function fetchPlaceReviews(session: Session, tripId: string, pinId: string): Promise<PlaceReviews | null> {
  const { data } = await httpsCallable<{ tripId: string; pinId: string }, Answer>(session.functions, 'placeReviews')({ tripId, pinId })
  return data.status === 'reviews' ? { reviews: data.reviews, placeUri: data.placeUri, photo: data.photo ?? null, sample: data.sample === true } : null
}
