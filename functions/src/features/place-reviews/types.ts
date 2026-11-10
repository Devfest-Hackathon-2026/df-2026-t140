import type { PlaceReviews } from '../../ports/places-api'

export interface PlaceReviewsInput {
  tripId: string
  pinId: string
  uid: string
}

/**
 * reviews：口コミを返す。unavailable：出せない（設定がない、合言葉を通していない、確かめていない場所、呼べなかった）。
 * not-member と not-found は handler がエラーにする
 */
export type PlaceReviewsResult =
  | ({ status: 'reviews' } & PlaceReviews)
  | { status: 'unavailable' }
  | { status: 'not-member' }
  | { status: 'not-found' }
