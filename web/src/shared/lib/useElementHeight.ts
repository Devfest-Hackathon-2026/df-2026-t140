import { type RefCallback, useCallback, useRef, useState } from 'react'

/**
 * 要素の高さ（px）を、変わるたびに測る。返す ref を、測りたい要素に付ける。
 * 下のシートの高さを地図に伝えて、地図の印やロゴが隠れないようにするのに使う。
 */
export function useElementHeight(): [RefCallback<HTMLElement>, number] {
  const [height, setHeight] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback<RefCallback<HTMLElement>>((element) => {
    observer.current?.disconnect()
    observer.current = null
    if (!element) return
    observer.current = new ResizeObserver(() => setHeight(Math.round(element.getBoundingClientRect().height)))
    observer.current.observe(element)
  }, [])

  return [ref, height]
}
