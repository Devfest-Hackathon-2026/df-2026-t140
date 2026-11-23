import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import { type AppLanguage, appLanguage } from '@/shared/lib'

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
  /** 場所の公式サイト（Places の websiteUri）。ないときは null。宿の場所の情報のリンクに使う。保存しない */
  website: string | null
  /** 開発環境の見本か（Google マップの口コミ・写真ではない）。Google マップの出典を出さない */
  sample: boolean
}

/** 公式サイトの URL は http か https だけを通す（Functions でも確かめているが、リンクにするので画面でも確かめる） */
function webOrNull(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\/\S+$/.test(value) ? value : null
}

type Answer = ({ status: 'reviews' } & PlaceReviews) | { status: 'unavailable' }

/**
 * 場所の口コミと写真 1 枚を Functions に聞く（functions/src/features/place-reviews）。
 * 出せないとき（人が決める前、合言葉を通していない、確かめていない場所、開発環境）は null
 */
export async function fetchPlaceReviews(session: Session, tripId: string, pinId: string): Promise<PlaceReviews | null> {
  // 口コミは表示言語で聞く（英語なら Google が訳した口コミ）。言語を切り替えるとページを読み直すので、覚えた口コミと混ざらない
  const { data } = await httpsCallable<{ tripId: string; pinId: string; language: AppLanguage }, Answer>(session.functions, 'placeReviews')({ tripId, pinId, language: appLanguage })
  return data.status === 'reviews' ? { reviews: data.reviews, placeUri: data.placeUri, photo: data.photo ?? null, website: webOrNull(data.website), sample: data.sample === true } : null
}
