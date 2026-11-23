export interface RepeatVisitInput {
  tripId: string
  /** 画面が出しているしおりのルート（ふつうは shiori。前の形で決まった旅は、決まったルート） */
  routeId: string
  /** 複製する行、または消す行（行の ID。ふつうはピンの ID。domain/visit.ts） */
  stopId: string
  /** true なら、その行を消す。false なら、その行のすぐ下に同じ場所の行を足す */
  remove: boolean
  /** 操作した人 */
  uid: string
}

export type RepeatVisitResult =
  /** 足して（消して）保存した。revision は保存したあとの組み直しの回数 */
  | { status: 'changed'; revision: number }
  /** 断る */
  | { status: 'not-member' }
  | { status: 'not-found' }
  /** 旅程が確定している */
  | { status: 'confirmed' }
  /** その行が今のしおりにない（ほかの人が消した、順番が変わった） */
  | { status: 'stale' }
  /** 行の数が上限（MAX_STOPS）に届いていて、足せない */
  | { status: 'full' }
  /** その場所の最後の 1 行は消せない（場所ごと外すのは、建物を消す） */
  | { status: 'last' }
