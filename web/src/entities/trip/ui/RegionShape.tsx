import type { RegionId } from '../model/regions'
import { regionRings } from '../model/regionShapes'
import styles from './RegionShape.module.css'

interface Shape {
  viewBox: string
  d: string
  stroke: number
}

const shapes = new Map<RegionId, Shape>()

// 地方の形を、その地方がちょうど収まる絵にする。経度は日本のあたりの緯度で縮め、北を上にする
function shapeOf(id: RegionId): Shape {
  const known = shapes.get(id)
  if (known) return known
  const squeeze = Math.cos((36 * Math.PI) / 180)
  const rings = regionRings(id).map((ring) => ring.map(({ lat, lng }) => [lng * squeeze, -lat] as const))
  const xs = rings.flat().map(([x]) => x)
  const ys = rings.flat().map(([, y]) => y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const side = Math.max(x1 - x0, y1 - y0) * 1.08
  const left = (x0 + x1) / 2 - side / 2
  const top = (y0 + y1) / 2 - side / 2
  const d = rings
    .map((ring) => `M${ring.map(([x, y]) => `${(x - left).toFixed(3)},${(y - top).toFixed(3)}`).join('L')}Z`)
    .join('')
  const shape = { viewBox: `0 0 ${side.toFixed(3)} ${side.toFixed(3)}`, d, stroke: side / 40 }
  shapes.set(id, shape)
  return shape
}

interface Props {
  id: RegionId
  /** 選んだ地方（濃い緑）、一部の県だけ選んだ地方（うすい緑） */
  look: 'picked' | 'part' | 'none'
  /** 一辺の大きさ（px） */
  size?: number
}

/** 地方の形（自分たちで用意した地方の形。model/regionShapes.ts）。地方の一覧で、名前の横に出す */
export function RegionShape({ id, look, size = 32 }: Props) {
  const shape = shapeOf(id)
  return (
    <svg className={`${styles.shape} ${styles[look]}`} width={size} height={size} viewBox={shape.viewBox} aria-hidden="true">
      <path d={shape.d} strokeWidth={shape.stroke} />
    </svg>
  )
}
