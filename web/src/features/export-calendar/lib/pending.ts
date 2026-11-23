// Google のログインの画面へ移る・アカウントを切り替えて読み込み直すあいだ、どの旅のカレンダーへの書き出しの途中かを覚える。
// タブの中だけに置く。使えない環境では覚えないだけ（もう一度押せばよい）
const KEY = 'calendarExportTrip'

export function rememberPendingExport(tripId: string): void {
  try {
    sessionStorage.setItem(KEY, tripId)
  } catch {
    // 覚えられなくても、書き出しはできる
  }
}

export function pendingExportTrip(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function forgetPendingExport(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // 消せなくても困らない
  }
}
