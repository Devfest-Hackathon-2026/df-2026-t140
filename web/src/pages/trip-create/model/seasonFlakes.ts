// 旅をつくる画面の地図に重ねる、舞う紅葉・雪・桜（ui/SeasonFlakes）の位置と速さ。画面の部品から分けた計算

import type { Season } from '@/entities/trip'

/** 舞うものの数（夏は舞わない。冬は多め） */
export const FLAKE_COUNTS: Record<Season, number> = { spring: 16, summer: 0, autumn: 16, winter: 26 }

/** 舞うもの（紅葉・雪・桜）の位置と速さ。毎回同じになるよう、決まった乱数で作る（描き直しのたびに動きが変わらないように） */
export function flakeLooks(count: number, colors: readonly string[]) {
  let seed = 11
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  return Array.from({ length: count }, (_, i) => {
    const duration = 5 + random() * 5
    return {
      left: `${(random() * 100).toFixed(1)}%`,
      duration: `${duration.toFixed(1)}s`,
      delay: `-${(random() * duration).toFixed(1)}s`,
      sway: `${(1.4 + random() * 1.6).toFixed(1)}s`,
      scale: (0.7 + random() * 0.6).toFixed(2),
      color: colors[i % colors.length],
    }
  })
}
