/** 引き継いだときに画面へ返すもの。moved は引き継いだ旅の数（0 のこともある） */
export interface MoveMembershipsResult {
  moved: number
}

/**
 * 断る理由。断るときは handler が HttpsError を投げ、結果は返さない。
 * invalid-token：前の自分のトークンが、匿名ログインの人の本物のトークンではない。
 * same：前の自分と今の自分が同じ人。
 */
export type MoveMembershipsRefusal = 'invalid-token' | 'same'
