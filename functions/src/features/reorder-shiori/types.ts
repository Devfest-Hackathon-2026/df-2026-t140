export interface ReorderShioriInput {
  tripId: string
  /** 画面が出しているしおりのルート（ふつうは shiori。前の形で決まった旅は、決まったルート） */
  routeId: string
  /** 取って動かした行と、落とした先の行（行の ID。ふつうはピンの ID。domain/visit.ts）。取った行を、落とした先の行の位置に差し込む */
  fromPinId: string
  toPinId: string
  /** 動かした人 */
  uid: string
}

export type ReorderShioriResult =
  /** 動かして保存した。revision は保存したあとの組み直しの回数 */
  | { status: 'reordered'; revision: number }
  /** 断る */
  | { status: 'not-member' }
  | { status: 'not-found' }
  /** しおりにない場所か、同じ場所どうし */
  | { status: 'invalid' }
  /** 旅程が確定している（features/confirm-shiori） */
  | { status: 'confirmed' }
