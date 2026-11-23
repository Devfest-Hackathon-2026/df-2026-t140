import { translate as t } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import { useWelcomeSprites } from '../model/useWelcomeSprites'
import styles from './WelcomeScene.module.css'

/** 斜めの列の数と、1 列に並べる模型の数（列は画面の斜めの長さより長くし、同じ並びを 2 回続けて、つなぎ目なく流す） */
const LANES = 9
const PER_LANE = 12

/**
 * ようこその 1 枚。真ん中にアプリの名前を置き、後ろで実際の模型がたくさん、斜めの何本かの列に沿って、左下から右上へ 1 つずつ流れていく。
 * 列は模型の見え方（等角）に合わせて 30 度傾け、模型そのものは傾けない。手前の模型が奥の模型に重なるよう、奥（右上）から描く。
 * 動きを減らす設定では止める
 */
export function WelcomeScene() {
  const sprites = useWelcomeSprites()
  return (
    <div className={styles.scene} aria-hidden="true">
      {sprites && sprites.length > 0 && (
        <div className={styles.lanes}>
          {Array.from({ length: LANES }, (_, lane) => {
            // 列ごとに並びをずらし、隣の列と同じ模型が並ばないようにする
            const row = Array.from({ length: PER_LANE }, (_, at) => sprites[(at + lane * 5) % sprites.length])
            const items = [...row, ...row].reverse()
            return (
              <div key={lane} className={styles.lane} style={{ ['--lane' as string]: lane }}>
                <div className={styles.strip}>
                  {items.map((src, at) => (
                    <img key={at} className={styles.model} src={src} alt="" draggable={false} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className={styles.logo}>
        <Icon name="pin" size={40} />
        <span className={styles.name}>{t('たびむすび', 'Tabimusubi')}</span>
      </div>
    </div>
  )
}
