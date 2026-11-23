/**
 * 入力欄に合わせた画面の拡大を、元に戻すための道具。
 * iPhone の Safari は、文字が 16px より小さい入力欄に入ると画面を拡大し、入力を終えても元に戻さない。
 * 入力を始めるときに pageZoom() で今の拡大率と位置を覚え、終えたら restorePageZoom() で戻す
 */
export interface PageZoom {
  /** 入力を始めたときの拡大率（1 で拡大なし） */
  scale: number
  scrollX: number
  scrollY: number
}

/** viewport の meta を元に戻すまで待つ時間。すぐ戻すと、Safari が拡大を解く前に元の上限に戻ってしまう */
const RELEASE_MS = 300

/** 今の拡大率と、ページのスクロールの位置 */
export function pageZoom(): PageZoom {
  return { scale: window.visualViewport?.scale ?? 1, scrollX: window.scrollX, scrollY: window.scrollY }
}

/**
 * 入力の間に画面が拡大されていたら、入力を始めたときの拡大率と位置に戻す。
 * viewport の meta に一時的に maximum-scale=1 を足して拡大を解き、少し待って元の内容に戻す（ピンチでの拡大は今までどおりできる）。
 * 入力を始める前から人が指で拡大していたときは、その拡大を選んだのは人なので戻さない。
 * スクロールの位置は、待つあいだに動いていなければ戻す（人がスクロールした先や、移った先の画面を前の位置へ飛ばさない）。
 * keepScroll を false にすると、位置は戻さない（欄が消えたとき。画面を移った先かもしれないため）
 */
export function restorePageZoom(before: PageZoom | null, keepScroll = true): void {
  if (!before || before.scale > 1.01) return
  const now = window.visualViewport?.scale ?? 1
  if (now <= 1.01) return
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  const original = meta.content
  if (/maximum-scale/.test(original)) return
  meta.content = `${original}, maximum-scale=1`
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  window.setTimeout(() => {
    // 拡大が解けてから、押す前の位置に戻す。待つあいだに位置が動いていたら、そのままにする
    if (keepScroll && window.scrollX === scrollX && window.scrollY === scrollY) window.scrollTo(before.scrollX, before.scrollY)
    meta.content = original
  }, RELEASE_MS)
}
