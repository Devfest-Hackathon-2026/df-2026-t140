// しおり（S11）のシートを全面にしたとき・戻すときの、高さの見積もり。

/** ふつうの高さのシートの上限（画面の高さに対する割合。ShioriSheet.module.css の .sheet の max-height と合わせる） */
const HALF_VIEWPORT_RATIO = 0.52
/** 下の欄の上限（ページの高さに対する割合。TripMapPage.module.css の .bottom の max-height と合わせる） */
const BOTTOM_PAGE_RATIO = 0.78
/** これより低い画面では、ふつうの高さの上限を外す（ShioriSheet.module.css の @media (max-height: 500px) と合わせる） */
const LOW_SCREEN_PX = 500

/**
 * ふつうの高さの上限（px）。viewport は画面の高さ、page はページ（枠の内側）の高さ。
 * 低い画面では、下の欄の上限だけが効く
 */
export function halfSheetLimit(viewport: number, page: number): number {
  const bottom = page * BOTTOM_PAGE_RATIO
  return viewport <= LOW_SCREEN_PX ? bottom : Math.min(bottom, viewport * HALF_VIEWPORT_RATIO)
}

/**
 * 行の欄（スクロールする欄）が、中身ぶんの高さだけになったときに、シートの中で占める高さ（px）。
 * 全面のあいだ、行の欄は残りの高さいっぱいに伸びているので、欄の高さ（scrollHeight も、行が少ないと伸びた高さを返す）でなく、
 * 中の最初の子の上から最後の子の下までを測る。欄の上下の余白と外の余白（下は負の値。シートの下の余白へ食い込ませている）も足す
 */
function scrollContentHeight(area: HTMLElement): number {
  const items = Array.from(area.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return area.offsetHeight
  const style = getComputedStyle(area)
  const px = (value: string) => Number.parseFloat(value) || 0
  const inner = Math.max(0, last.getBoundingClientRect().bottom - first.getBoundingClientRect().top)
  return inner + px(style.paddingTop) + px(style.paddingBottom) + px(style.marginTop) + px(style.marginBottom)
}

/**
 * 全面の形のシートが、ふつうの高さに戻ったときの高さ（px）を見積もる。
 * 中身が上限より低ければ中身の高さ、高ければ上限。中身の高さは、子の高さ（行の欄は、その中身の高さ）と、
 * すきま、上下の余白、上の枠線を足して出す。外に浮かべた部品（position: absolute）と、全面のときだけ出す部品（data-sheet-tall-only）は数えない
 */
export function halfSheetHeight(sheet: HTMLElement): number {
  const style = getComputedStyle(sheet)
  const px = (value: string) => Number.parseFloat(value) || 0
  const children = Array.from(sheet.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.sheetTallOnly === undefined && getComputedStyle(child).position !== 'absolute',
  )
  const content = children.reduce(
    (sum, child) => sum + (child.dataset.sheetScroll !== undefined ? scrollContentHeight(child) : child.offsetHeight),
    0,
  )
  const natural =
    content + px(style.rowGap) * Math.max(0, children.length - 1) + px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth)
  const page = sheet.closest<HTMLElement>('[data-sheet-page]')
  return Math.min(natural, halfSheetLimit(window.innerHeight, page?.clientHeight ?? window.innerHeight))
}
