// 画面の Timestamp と firebase-admin の Timestamp のどちらも受けられる形。
// domain は SDK を import しないので、時刻はこの形で受け取る。
export interface TimestampLike {
  toMillis(): number
  toDate(): Date
}
