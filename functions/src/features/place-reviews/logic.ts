import type { PlaceReviews } from '../../ports/places-api'

// 口コミの呼び出し口の純粋な決め。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** 見本の写真（web/public/dev/ に置いた、自分たちで描いた絵。Google マップの写真ではない） */
export const SAMPLE_PHOTO_PATH = '/dev/sample-place-photo.svg'

const SAMPLE_AUTHOR = '見本（開発用）'

/**
 * 開発環境（Emulator）で返す、見本の口コミと写真。手元で見た目を確かめるためだけのもので、本物の口コミではない。
 * 見本と分かるよう、投稿者の名前と本文に開発用と書く。写真は photo が true のときだけ（候補の場所カードには付けない。本番と同じ）
 */
export function sampleReviews(placeName: string, photo: boolean): PlaceReviews {
  const review = (text: string, rating: number, relativeTime: string) => ({
    author: SAMPLE_AUTHOR,
    authorUri: null,
    authorPhotoUri: null,
    rating,
    text: `【開発用の見本】${text}`,
    relativeTime,
    mapsUri: null,
    flagUri: null,
  })
  return {
    reviews: [
      review(`${placeName}の口コミの見本です。本番では、ここに Google マップの口コミが出ます。`, 5, '1 週間前'),
      review('長い口コミのときの見た目を確かめるための文です。朝早く行くと人が少なく、ゆっくり見て回れました。帰りに近くの店で名物を食べたのもよい思い出です。', 4, '1 か月前'),
      review('短い口コミの見本です。', 3, '3 か月前'),
    ],
    placeUri: null,
    photo: photo ? { uri: SAMPLE_PHOTO_PATH, authors: [] } : null,
    sample: true,
  }
}
