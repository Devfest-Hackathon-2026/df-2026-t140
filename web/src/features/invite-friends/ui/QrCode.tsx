import { translate } from '@/shared/lib'
import { useMemo } from 'react'
import { qrDrawing } from '../lib/qrPath'

interface Props {
  text: string
  size?: number
}

// まわりに 4 マス分の白い余白を取る（読み取りに必要）
const QUIET = 4

/** QR コード。白地に黒で描く（読み取りやすさを優先し、見た目の案の色は使わない） */
export function QrCode({ text, size = 176 }: Props) {
  const { count, path } = useMemo(() => qrDrawing(text), [text])
  const side = count + QUIET * 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`}
      role="img"
      aria-label={translate('招待リンクの QR コード', "Invitation link QR code")}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
