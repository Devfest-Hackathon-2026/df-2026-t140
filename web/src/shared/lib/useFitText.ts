import { type RefCallback, useCallback, useLayoutEffect, useRef } from 'react'

/** 1 行とみなす高さ（行の高さの何倍まで）。2 行なら 2 倍前後になる */
const ONE_LINE = 1.5

/**
 * 文字を 1 行に収める。1 行に入らないときは、max（px）から 1px ずつ小さくし、1 行に入る大きさにする。
 * min まで小さくしても入らないときは min のまま（折り返しは、要素の CSS に任せる）。
 * text は測り直す目印（文字のほか、文字の横に並ぶものの数など、幅に関わるものを入れる）。textRef を文字の要素に、boxRef を幅の決まる外側の要素に付ける。外側の幅が変わるたびに測り直す。
 * 大きさは要素の style に直接書く（測るたびに描き直さない）。enabled が false のときは書いた大きさを消し、CSS の大きさに戻す
 */
export function useFitText(text: string, max: number, min: number, enabled = true): [RefCallback<HTMLElement>, RefCallback<HTMLElement>] {
  const textElement = useRef<HTMLElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const limits = useRef({ max, min, enabled })
  // 測るときに使う範囲を、描いたあとで最新にする（下の測り直しより先に動く）
  useLayoutEffect(() => {
    limits.current = { max, min, enabled }
  })

  const fit = useCallback(() => {
    const element = textElement.current
    if (!element) return
    const { max: largest, min: smallest, enabled: on } = limits.current
    if (!on) {
      element.style.fontSize = ''
      return
    }
    for (let size = largest; size >= smallest; size -= 1) {
      element.style.fontSize = `${size}px`
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || size * 1.3
      if (element.scrollHeight <= lineHeight * ONE_LINE) return
    }
  }, [])

  const textRef = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      textElement.current = element
      fit()
    },
    [fit],
  )

  const boxRef = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      observer.current?.disconnect()
      observer.current = null
      if (!element) return
      // 外側の幅が変わったときだけ測り直す（文字を小さくして高さが変わったときには測らない）
      let width = -1
      observer.current = new ResizeObserver(() => {
        const next = Math.round(element.getBoundingClientRect().width)
        if (next === width) return
        width = next
        fit()
      })
      observer.current.observe(element)
    },
    [fit],
  )

  // 名前が変わったとき、大きさの範囲が変わったときも測り直す
  useLayoutEffect(fit, [fit, text, max, min, enabled])
  // 文字の書体が読み込まれると幅が変わるので、読み込みのあとにも測り直す。
  // 日本語の書体は文字の範囲ごとに後から読み込まれる（名前が変わると、その文字の分が届く）ので、読み込みが終わるたびに測る
  useLayoutEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    if (!fonts) return
    let alive = true
    void fonts.ready.then(() => {
      if (alive) fit()
    })
    fonts.addEventListener('loadingdone', fit)
    return () => {
      alive = false
      fonts.removeEventListener('loadingdone', fit)
    }
  }, [fit])

  return [textRef, boxRef]
}
