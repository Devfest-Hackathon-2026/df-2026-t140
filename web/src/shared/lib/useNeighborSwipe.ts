import { learnSwipe } from './swipeHint'
import { useSwipe } from './useSwipe'
import { playSound } from './sound'

/** となりの場所。name は、のぞくカードの読み上げに使う */
export interface Neighbor {
  name: string
  go: () => void
}

/**
 * 前・次の場所へ移る処理と、カードに付けるスワイプの処理。端なら prev・next を渡さない。
 * 一度でも移ったら、スワイプできることを教える合図はもう出さない（learnSwipe）
 */
export function useNeighborSwipe(prev: Neighbor | undefined, next: Neighbor | undefined) {
  const goPrev =
    prev &&
    (() => {
      learnSwipe()
      playSound('switch')
      prev.go()
    })
  const goNext =
    next &&
    (() => {
      learnSwipe()
      playSound('switch')
      next.go()
    })
  const swipe = useSwipe(goPrev, goNext)
  return { goPrev, goNext, swipe }
}
