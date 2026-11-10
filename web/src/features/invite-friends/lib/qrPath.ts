import qrcode from 'qrcode-generator'

export interface QrDrawing {
  /** 1 辺のマスの数 */
  count: number
  /** 黒いマスを、1 マス = 1 の大きさで描く SVG のパス */
  path: string
}

/** 文字を QR コードにし、SVG で描ける形にする */
export function qrDrawing(text: string): QrDrawing {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) path += `M${column} ${row}h1v1h-1z`
    }
  }
  return { count, path }
}
