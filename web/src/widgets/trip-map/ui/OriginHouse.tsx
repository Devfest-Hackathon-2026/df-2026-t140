import { translate } from '@/shared/lib'
import { ModelSprite } from '@/entities/model3d'
import { ORIGIN_HOUSE_MODEL } from '../lib/originHouseModel'
import styles from './OriginHouse.module.css'

interface Props {
  /** 出発地の名前（入力された出発地） */
  name: string
}

/** 家の模型の絵の大きさ（px） */
const HOUSE_SIZE = 64

/**
 * 旅をつくる画面の地図で、出発地に立てる家。
 * 家は、建物と同じ模型（Gemini に作らせた JSON。lib/originHouseModel.ts）を、建物と同じ描き方で絵にして置く。
 * 親は、その場所を指す点。家は上へ、名札は下へ描く（MapPin と同じ置き方）。押せない
 */
export function OriginHouse({ name }: Props) {
  return (
    <span className={styles.house} role="img" aria-label={translate(`出発地：${name}`, `Starting point: ${name}`)}>
      <span className={styles.smoke} aria-hidden="true" />
      {/* 模型の原点（地面の真ん中）を、この大きさ 0 の点に重ねる */}
      <span className={styles.building} aria-hidden="true">
        <ModelSprite model={ORIGIN_HOUSE_MODEL} size={HOUSE_SIZE} anchored />
      </span>
      <span className={styles.name}>{name}</span>
    </span>
  )
}
