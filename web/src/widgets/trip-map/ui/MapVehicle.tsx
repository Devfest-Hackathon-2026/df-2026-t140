import { ModelSprite } from '@/entities/model3d'
import { CAR_MODEL } from '../lib/carModel'
import styles from './MapVehicle.module.css'

interface Props {
  /** 走る向き（度。北が 0 で、時計回り） */
  heading: number
  /** 絵の大きさ（px） */
  size: number
}

/** 向きを何度きざみで描き分けるか。同じきざみの絵は 1 回だけ描いて使い回す */
const HEADING_STEP = 22.5

/**
 * 地図の上の向き（北が 0、時計回り）から、模型を回す角度（上から見て反時計回り）にする。
 * 絵は南東の上から見下ろしているので、模型の前（+x）は、回さないと地図の東北東（135 度の向きのぶんずれる）を向く
 */
export function carYaw(heading: number): number {
  const snapped = Math.round(heading / HEADING_STEP) * HEADING_STEP
  return (((135 - snapped) % 360) + 360) % 360
}

/** しおりの再生で、道順をたどって走る車。模型を、走る向きに回した絵にして置く（どの面でも同じ見え方） */
export function MapVehicle({ heading, size }: Props) {
  return (
    <span className={styles.car} role="img" aria-label="車">
      <ModelSprite model={CAR_MODEL} size={size} yaw={carYaw(heading)} anchored />
    </span>
  )
}
