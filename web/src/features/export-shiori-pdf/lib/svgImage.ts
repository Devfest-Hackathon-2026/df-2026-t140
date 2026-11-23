/**
 * 画面に描いたアイコン（線だけの SVG）を、canvas に描ける画像にする。線の色（currentColor）は color にする。
 * 外から取ってくるものはないので、canvas は汚れない（あとで JPEG に書き出せる）
 */
export async function svgImage(markup: string, color: string): Promise<HTMLImageElement> {
  const svg = markup.replaceAll('currentColor', color)
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  return image
}

/** 画像の URL（模型の絵の data URL）を、canvas に描ける画像にする */
export async function urlImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

/** canvas を JPEG のバイト列にする */
export function canvasJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('JPEG にできませんでした'))
          return
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
      },
      'image/jpeg',
      quality,
    )
  })
}
