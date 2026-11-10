// 画面（iframe の中の本物のアプリ）を、人の代わりに操作する小さな道具。
// 要素は、見た目ではなく、読み上げの名前（aria-label か文字）で探す。人が画面でするのと同じ操作だけにする。

export type Doc = Document

const nameOf = (element: Element): string => (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ボタンかリンクを、読み上げの名前で探す。exact が false なら、名前がその文字で始まるもの */
export function findControl(doc: Doc, name: string, exact = true): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('button, a[href]'))
  return candidates.find((element) => (exact ? nameOf(element) === name : nameOf(element).startsWith(name))) ?? null
}

/** ラベルの文字から、その入力欄を探す */
export function findInput(doc: Doc, label: string): HTMLInputElement | null {
  const byAria = doc.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (byAria) return byAria
  const labels = Array.from(doc.querySelectorAll<HTMLLabelElement>('label'))
  const match = labels.find((element) => (element.textContent ?? '').trim().startsWith(label))
  return match?.querySelector('input') ?? null
}

/** 画面に、その文字が出ているか */
export function hasText(doc: Doc, text: string): boolean {
  return (doc.body?.textContent ?? '').includes(text)
}

/** React の制御された入力欄に、人が打ったのと同じように値を入れる（前の値は消す） */
export function typeInto(input: HTMLInputElement, value: string): void {
  const view = input.ownerDocument.defaultView as (Window & typeof globalThis) | null
  const proto = view ? view.HTMLInputElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  input.focus()
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** 押す。ピンが重なって覆われていても、その要素を押す */
export function press(element: HTMLElement): void {
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  element.click()
}

/** 読み上げの名前（aria-label）に、その文字を含む要素があるか */
export function hasLabel(doc: Doc, text: string): boolean {
  return Array.from(doc.querySelectorAll('[aria-label]')).some((element) => (element.getAttribute('aria-label') ?? '').includes(text))
}

/** ボタンかリンクを、中の文字で探す（しおりの行のように、名前が時刻などのあとに来るもの） */
export function findControlContaining(doc: Doc, text: string): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('button, a[href]'))
  return candidates.find((element) => nameOf(element).includes(text)) ?? null
}

/** しおり（S11）のシートの文字。開いていなければ空 */
export function shioriText(doc: Doc): string {
  return doc.querySelector('[aria-label="しおり"]')?.textContent ?? ''
}
