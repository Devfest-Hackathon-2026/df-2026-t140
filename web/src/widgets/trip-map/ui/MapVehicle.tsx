import { type ModelJson, ModelSprite, renderModelSprite } from '@/entities/model3d'
import { translate } from '@/shared/lib'
import { CAR_MODEL, PLANE_MODEL, TRAIN_MODEL, WALKER_MODEL, WALKER_STEPS } from '../lib/vehicleModels'
import styles from './MapVehicle.module.css'

/** 再生で走る乗り物。区間の手段から、ページが選ぶ */
export type TourVehicle = 'car' | 'train' | 'walker' | 'plane'

const VEHICLES: Record<TourVehicle, { model: ModelJson; label: string }> = {
  car: { model: CAR_MODEL, label: translate('車', 'Car') },
  train: { model: TRAIN_MODEL, label: translate('電車', 'Train') },
  walker: { model: WALKER_MODEL, label: translate('歩く人', 'Walker') },
  plane: { model: PLANE_MODEL, label: translate('飛行機', 'Plane') },
}

interface Props {
  vehicle: TourVehicle
  /** 走る向き（度。北が 0 で、時計回り） */
  heading: number
  /** 絵の大きさ（px） */
  size: number
  /** 区間を進んでいる途中か。歩く人は、進んでいるあいだだけ足を動かす */
  moving?: boolean
  /** 地面からどれだけ浮かせるか（px）。飛行機が飛んでいるあいだ */
  lift?: number
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

/**
 * しおりの再生で、道順をたどって走る乗り物。模型を、走る向きに回した絵にして置く（どの面でも同じ見え方）。
 * 歩く人は、足を開いた 2 つの絵を重ねておき、CSS で交互に出して歩かせる（描き直さない）
 */
export function MapVehicle({ vehicle, heading, size, moving = false, lift = 0 }: Props) {
  const { model, label } = VEHICLES[vehicle]
  const yaw = carYaw(heading)
  const walking = vehicle === 'walker' && moving
  // 飛行機は浮かせるので、模型の絵には影を描かず、地面に別の影を置く（絵の影ごと浮かないように）。
  // 絵が描けない（WebGL が使えない）ときは、影だけが動かないよう、影も出さない（絵は 1 回だけ描いて使い回す）
  const flying = vehicle === 'plane'
  const groundShadow = flying && renderModelSprite(model, yaw, false) !== null
  const bodyClass = [styles.body, walking && styles.walking, flying && styles.flying].filter(Boolean).join(' ')
  return (
    <span className={styles.car} role="img" aria-label={label}>
      {groundShadow && <span className={styles.shadow} style={{ width: size * 0.62, height: size * 0.3 }} />}
      <span className={bodyClass} style={lift > 0 ? { transform: `translateY(${-lift}px)` } : undefined}>
        {walking ? (
          WALKER_STEPS.map((step, index) => (
            <span key={index} className={styles.step}>
              <ModelSprite model={step} size={size} yaw={yaw} anchored />
            </span>
          ))
        ) : (
          <ModelSprite model={model} size={size} yaw={yaw} shadow={!flying} anchored />
        )}
      </span>
    </span>
  )
}
