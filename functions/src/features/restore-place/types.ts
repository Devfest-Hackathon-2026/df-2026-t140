export interface RestorePlaceInput {
  tripId: string
  /** しおりに戻す建物（ピンの ID） */
  pinId: string
  /** 戻した人 */
  uid: string
}

export type RestorePlaceResult =
  /** しおりに戻した。routes は組み直したルートの数 */
  | { status: 'restored'; routes: number }
  /** 外した印のあるルートがない（もうしおりに入っている）。何も変えない */
  | { status: 'unchanged' }
  /** 断る */
  | { status: 'not-member' }
  | { status: 'not-found' }
  /** まだ建っていない */
  | { status: 'not-built' }
  /** 旅程が確定している（features/confirm-shiori） */
  | { status: 'confirmed' }
