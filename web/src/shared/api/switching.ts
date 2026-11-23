// 人を切り替えている（連携済みの Google アカウントの自分へ、ログアウト）途中の印。切り替えたらページを読み込み直すので、
// そのあいだは画面を隠す。前の人のまま開いている購読が権限で断られ、エラーの表示が一瞬出るのを見せないため。
// 印は接続（Auth）ごとに持つ。複数人シミュレーションでは、画面ごとに別の接続になる

const switching = new Set<object>()
const listeners = new Set<() => void>()

/** 切り替えを始める（on）・やめる（off）。変わったら知らせる */
export function markSwitching(auth: object, on: boolean): void {
  if (on === switching.has(auth)) return
  if (on) switching.add(auth)
  else switching.delete(auth)
  for (const listener of listeners) listener()
}

/** この接続で人を切り替えている途中か（このあとページを読み込み直す） */
export function isSwitchingAccount(auth: object): boolean {
  return switching.has(auth)
}

/** 人の切り替えが始まった・やめたときに知らせる */
export function subscribeSwitching(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}
