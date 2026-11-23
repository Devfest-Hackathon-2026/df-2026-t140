import { ModelSprite, specialtyModel } from '@/entities/model3d'
import { SPECIALTY_NAMES, type Specialty } from '@/entities/trip'
import styles from './SpecialtyIcon.module.css'

interface Props {
  name: Specialty
  className?: string
}

/**
 * 地方や県の名物のアイコン。地図の建物と同じ、3D の模型を斜め上から見た絵にする（entities/model3d の specialtyModel）。
 * 絵は模型の箱より広く写るので、枠より大きく描いて真ん中に置く
 */
export function SpecialtyIcon({ name, className }: Props) {
  const model = specialtyModel(name)
  return (
    <span className={className ? `${styles.icon} ${className}` : styles.icon} role="img" aria-label={SPECIALTY_NAMES[name]} title={SPECIALTY_NAMES[name]}>
      {model && <ModelSprite model={model} size={SPRITE_SIZE} className={styles.sprite} />}
    </span>
  )
}

/** 絵の大きさ（px）。枠（RegionPicker.module.css の .specialty）より大きく描き、はみ出したぶんは透明 */
const SPRITE_SIZE = 42
