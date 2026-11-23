// 回して見せる模型の、写す範囲の計算。three を使わない、ただの計算（scripts/web.test.mjs で確かめる）。

/** 回しながら確かめる向きの数（1 周を何等分するか） */
const YAW_STEPS = 36
/** 模型のいちばん外側と、絵の縁とのあいだに残す余白（絵の半分の幅に対する割合） */
const EDGE_MARGIN = 1.04

/** 模型が収まる、絵の半分の幅と高さ（カメラから見た単位）と、上下の真ん中 */
export interface TurntableFrame {
  halfWidth: number
  halfHeight: number
  middle: number
}

/**
 * 模型の頂点（x, y, z）を、y の軸のまわりに 1 周を YAW_STEPS 等分した向きごとに回し、toView でカメラから見た座標（左右、上下）にする。
 * そのいちばん外側に余白を足した範囲を返す。左右はカメラの真ん中（回す軸）から対称にとる。頂点が無ければ fallback
 */
export function turntableFrame(
  points: readonly (readonly [number, number, number])[],
  toView: (x: number, y: number, z: number) => readonly [number, number],
  fallback: TurntableFrame,
): TurntableFrame {
  let maxX = 0
  let minY = Infinity
  let maxY = -Infinity
  for (let step = 0; step < YAW_STEPS; step += 1) {
    const angle = (step / YAW_STEPS) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (const [x, y, z] of points) {
      // three の rotation.y と同じ向きに回す
      const [viewX, viewY] = toView(x * cos + z * sin, y, -x * sin + z * cos)
      maxX = Math.max(maxX, Math.abs(viewX))
      minY = Math.min(minY, viewY)
      maxY = Math.max(maxY, viewY)
    }
  }
  if (!Number.isFinite(minY)) return fallback
  return { halfWidth: maxX * EDGE_MARGIN, halfHeight: ((maxY - minY) / 2) * EDGE_MARGIN, middle: (minY + maxY) / 2 }
}

/** 絵の縦横の比（幅 ÷ 高さ）に合わせた、写す範囲（カメラの左右上下）。足りない向きは広げ、模型は真ん中に置く */
export function fitFrame(frame: TurntableFrame, aspect: number): { left: number; right: number; top: number; bottom: number } {
  const halfWidth = Math.max(frame.halfWidth, frame.halfHeight * aspect)
  const halfHeight = halfWidth / aspect
  return { left: -halfWidth, right: halfWidth, top: frame.middle + halfHeight, bottom: frame.middle - halfHeight }
}
