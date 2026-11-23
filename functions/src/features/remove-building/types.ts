export interface RemoveBuildingInput {
  tripId: string
  /** 消す建物（ピンの ID） */
  pinId: string
  /** 消した人 */
  uid: string
}

export type RemoveBuildingResult =
  /** 消して、その場所を含むしおり（ルート）を組み直した。routes は組み直した（か消した）ルートの数 */
  | { status: 'removed'; routes: number }
  /** 断る */
  | { status: 'not-member' }
  | { status: 'not-found' }
  /** まだ建っていない（候補、工事中、失敗）。工事中は模型を作る処理と重なるので、建ってから消す */
  | { status: 'not-built' }
  /** 旅程が確定している（建物を消さない。features/confirm-shiori） */
  | { status: 'confirmed' }
