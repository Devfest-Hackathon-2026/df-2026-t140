import { useMemo } from 'react'
import { renderModelSprite, SPRITE_ORIGIN } from '../lib/renderModelSprite'
import type { ModelJson } from '../model/types'

interface Props {
  model: ModelJson
  /** 絵の幅と高さ（px） */
  size: number
  /**
   * true なら、模型の原点（地面の真ん中）が、親の左上（大きさ 0 の点）に重なるように置く。地図の上に置くとき用。
   * false なら、ふつうの画像として置く。
   */
  anchored?: boolean
  /** 模型を上から見て反時計回りに回す角度（度）。渡さなければ 0 */
  yaw?: number
  className?: string
}

/**
 * 模型を、斜め上から見た絵として出す（three.js で 1 回だけ描いて、画像にする）。
 * WebGL が使えない環境では何も出さない（呼ぶ側の名札だけが残る）。
 */
export function ModelSprite({ model, size, anchored = false, yaw = 0, className }: Props) {
  const url = useMemo(() => renderModelSprite(model, yaw), [model, yaw])
  if (!url) return null
  const style = anchored
    ? {
        position: 'absolute' as const,
        left: -size * SPRITE_ORIGIN.x,
        top: -size * SPRITE_ORIGIN.y,
        maxWidth: 'none',
        pointerEvents: 'none' as const,
      }
    : undefined
  return <img className={className} src={url} width={size} height={size} alt="" style={style} draggable={false} />
}
