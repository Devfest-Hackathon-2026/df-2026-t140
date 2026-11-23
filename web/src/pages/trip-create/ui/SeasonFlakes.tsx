import type { Season } from '@/entities/trip'
import { FLAKE_COUNTS, flakeLooks } from '../model/seasonFlakes'
import styles from './SeasonFlakes.module.css'

const LEAF_COLORS = ['#e2552f', '#f09a2b', '#c93a24', '#f2c14e']

/**
 * 旅をつくる画面の地図の上に重ねる、日程の季節の舞うもの（秋は紅葉、冬は雪、春は桜。夏はなし）。
 * 地図そのもの（Google マップ）には描き込まず、上に重ねるだけ
 */
export function SeasonFlakes({ season }: { season: Season }) {
  const count = FLAKE_COUNTS[season]
  if (count === 0) return null
  return (
    <div key={season} className={styles.flakes} aria-hidden="true">
      {flakeLooks(count, LEAF_COLORS).map((look, i) => (
        <i key={i} className={styles.fall} style={{ left: look.left, animationDuration: look.duration, animationDelay: look.delay }}>
          <b
            className={`${styles.flake} ${styles[`flake_${season}`]}`}
            style={{ background: season === 'autumn' ? look.color : undefined, animationDuration: look.sway, scale: look.scale }}
          />
        </i>
      ))}
    </div>
  )
}
