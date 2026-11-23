import type { PlaceReviews, ReviewsLanguage } from '../../ports/places-api'

// 口コミの呼び出し口の純粋な決め。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/**
 * 画面から来た表示言語を確かめる。指定なし（undefined か null）は 'ja'（言語を送らない古い画面も今までどおり日本語）。
 * 'ja' と 'en' 以外は null（handler が invalid-argument にする。suggest-title と同じ流儀）
 */
export function readReviewsLanguage(value: unknown): ReviewsLanguage | null {
  if (value === undefined || value === null) return 'ja'
  return value === 'ja' || value === 'en' ? value : null
}

/** 見本の写真（web/public/dev/ に置いた、自分たちで描いた絵。Google マップの写真ではない） */
export const SAMPLE_PHOTO_PATH = '/dev/sample-place-photo.svg'

const SAMPLE_AUTHOR = { ja: '見本（開発用）', en: 'Sample (development)' }
const SAMPLE_MARK = { ja: '【開発用の見本】', en: '[Development sample] ' }

/** 見本の公式サイト（例示用のドメイン） */
export const SAMPLE_WEBSITE = 'https://example.com/'

/**
 * 開発環境（Emulator）で返す、見本の口コミと写真。手元で見た目を確かめるためだけのもので、本物の口コミではない。
 * 見本と分かるよう、投稿者の名前と本文に開発用と書く。写真は photo が true のときだけ（候補の場所カードには付けない。本番と同じ）。
 * 英語の表示（language が 'en'）では、本番で Places が訳して返すのに合わせて、見本も英語にする
 */
export function sampleReviews(placeName: string, photo: boolean, language: ReviewsLanguage = 'ja'): PlaceReviews {
  const review = (text: string, rating: number, relativeTime: string) => ({
    author: SAMPLE_AUTHOR[language],
    authorUri: null,
    authorPhotoUri: null,
    rating,
    text: `${SAMPLE_MARK[language]}${text}`,
    relativeTime,
    mapsUri: null,
    flagUri: null,
  })
  const reviews =
    language === 'en'
      ? [
          review(`A sample review of ${placeName}. In the live app, Google Maps reviews appear here.`, 5, 'a week ago'),
          review('This text checks how a long review looks. We went early in the morning, so it was quiet and we could look around at our own pace. Trying the local specialty at a shop nearby on the way back was a great memory too.', 4, 'a month ago'),
          review('A short sample review.', 3, '3 months ago'),
        ]
      : [
          review(`${placeName}の口コミの見本です。本番では、ここに Google マップの口コミが出ます。`, 5, '1 週間前'),
          review('長い口コミのときの見た目を確かめるための文です。朝早く行くと人が少なく、ゆっくり見て回れました。帰りに近くの店で名物を食べたのもよい思い出です。', 4, '1 か月前'),
          review('短い口コミの見本です。', 3, '3 か月前'),
        ]
  return {
    reviews,
    placeUri: null,
    photo: photo ? { uri: SAMPLE_PHOTO_PATH, authors: [] } : null,
    // 公式サイトのリンクの見た目を確かめるための、例示用のドメイン（RFC 2606。本物の宿のサイトではない）
    website: SAMPLE_WEBSITE,
    sample: true,
  }
}
