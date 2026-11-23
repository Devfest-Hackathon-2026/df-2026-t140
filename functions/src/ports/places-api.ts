// Google の Places API（テキスト検索）で、場所が実在するかと位置を聞く口の型（ポート）。実体は adapters/places-api.ts。
// Maps 由来の内容なので、3D 生成の入力（features/build-model）には渡さない（maps/no-generation-input、規約 3.2.3(c)）。
import type { LatLng } from '../domain/pin'

/** 見つかった場所。保存するのは place_id と位置だけ（名前や住所は保存しない） */
export interface FoundPlace {
  placeId: string
  location: LatLng
}

/**
 * 宿の候補を確かめた結果（features/suggest-places の宿さがし）。保存するのは place_id と位置だけで、種類と駐車場は候補をふるうのに使うだけ
 */
export interface FoundLodging extends FoundPlace {
  /** Places の種類に宿の種類（lodging、hotel、japanese_inn など）があるか */
  lodging: boolean
  /** 旅館（japanese_inn、budget_japanese_inn）か */
  ryokan: boolean
  /** 駐車場があるか。聞いていない・分からないときは null */
  parking: boolean | null
}

/** Google マップの口コミ 1 件。画面に出すだけで、どこにも保存しない（規約 3.2.3(a)(iii)） */
export interface PlaceReview {
  /** 投稿者の名前 */
  author: string
  /** 投稿者のプロフィール（Google マップ） */
  authorUri: string | null
  /** 投稿者のアバターの画像 */
  authorPhotoUri: string | null
  /** 1〜5。なければ null */
  rating: number | null
  /** 本文（日本語に訳されたもの。訳がなければ元の言葉） */
  text: string
  /** 「1 か月前」など */
  relativeTime: string
  /** この口コミを Google マップで開く */
  mapsUri: string | null
  /** 不適切な内容を報告する */
  flagUri: string | null
}

/** Google マップの写真 1 枚。画面に出すだけで、どこにも保存しない（規約で写真は保存できない） */
export interface PlacePhoto {
  /** 画像の URL（Places の写真の画像。キーは含まない。短い時間で使えなくなる） */
  uri: string
  /** 撮った人。写真のそばに名前とリンクを出す（Places の写真の表示の決まり） */
  authors: { name: string; uri: string | null }[]
}

export interface PlaceReviews {
  reviews: PlaceReview[]
  /** 場所を Google マップで開く */
  placeUri: string | null
  /** 写真 1 枚。写真を出す設定（PLACES_PHOTOS=on）がない、写真がない、取れなかったときは null */
  photo: PlacePhoto | null
  /**
   * 場所の公式サイト（Places の websiteUri）。ないときは null。宿の場所の情報で「公式サイト」のリンクに使う。
   * 口コミと同じ Place Details の呼び出しで受け取る（websiteUri は Enterprise の区分で、口コミの Enterprise + Atmosphere より下なので、料金は変わらない）。保存しない
   */
  website?: string | null
  /** 開発環境の見本か（Google マップの口コミ・写真ではない）。画面は Google マップの出典を出さず、見本と分かる表示にする */
  sample?: boolean
}

/**
 * 口コミを読む人の表示言語（画面の appLanguage）。'en' なら Places が英語に訳した本文と、英語の相対の日付（「a week ago」）が返る。
 * 訳がない口コミは元の言葉のまま返る
 */
export type ReviewsLanguage = 'ja' | 'en'

export interface PlacesApiPort {
  /** 呼べる設定か（キーがあり、Emulator ではない）。false なら findPlace は呼ばない */
  enabled(): boolean
  /**
   * 開発環境（Emulator）か。true なら口コミの呼び出し口は Places を呼ばず、開発用の見本の口コミと写真を返す
   * （手元で見た目を確かめるため。本番では false）
   */
  sampleMode(): boolean
  /** 名前で探し、near の近くを優先していちばん合う 1 件を返す。見つからない・呼べなかったときは null */
  findPlace(query: { text: string; near?: LatLng }): Promise<FoundPlace | null>
  /**
   * 口コミを出してよい設定か（キーがあり、Emulator ではなく、PLACES_REVIEWS=on）。
   * 口コミは別の料金の区分（Place Details Enterprise + Atmosphere）なので、人が決めるまでは on にしない
   * （todo/humans/2026-11-08-places-reviews.md）
   */
  reviewsEnabled(): boolean
  /**
   * place_id の口コミ（最大 5 件）と、写真を出す設定（PLACES_PHOTOS=on）があれば写真 1 枚（options.photo が false なら取らない）。呼べなかったときは null。
   * 口コミの言語は options.language（指定なしは 'ja'）。言語を変えても呼ぶ回数は同じ 1 回。
   * 写真は Place Photo の別の料金の区分なので、人が 1 日の上限を 0 回から上げるまでは on にしない
   */
  reviews(placeId: string, options?: { photo?: boolean; language?: ReviewsLanguage }): Promise<PlaceReviews | null>
  /**
   * 名前で探し、near の近くを優先していちばん合う 1 件の place_id だけを返す（位置は受け取らない）。
   * 場所の ID だけを受け取るテキスト検索（Text Search Essentials (IDs Only)）なので、回数の上限なく無料。
   * 候補のピンの口コミを出すときに使う。見つからない・呼べなかったときは null
   */
  findPlaceId(query: { text: string; near: LatLng }): Promise<string | null>
  /**
   * 宿の候補を名前で探し、near の近くを優先していちばん合う 1 件の位置、種類、（parking が true なら）駐車場を返す。
   * テキスト検索 1 回（1 日の上限は findPlace と分け合う）。種類を聞くので Text Search Pro、駐車場も聞くと Enterprise + Atmosphere の区分になる。
   * 見つからなかったときは 'not-found'、呼べなかった（上限、通信の失敗）ときは null（確かめられなかったので、候補は外さない）
   */
  findLodging(query: { text: string; near: LatLng; parking: boolean }): Promise<FoundLodging | 'not-found' | null>
}
