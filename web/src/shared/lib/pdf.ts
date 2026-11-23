// JPEG の画像を 1 枚ずつページにした PDF を作る。外のライブラリは使わない。
// PDF は JPEG（DCTDecode）をそのまま中に入れられるので、画像を作り直さずに包むだけでよい。
// scripts/web.test.mjs が Node でそのまま読むので、別名（@/）の import を使わない。

/** 1 ページ分の JPEG。width と height は画像の画素数 */
export interface PdfPageImage {
  jpeg: Uint8Array<ArrayBuffer>
  width: number
  height: number
}

/** A4 縦の大きさ（pt。1 pt は 1/72 インチ） */
export const A4_POINTS = { width: 595.28, height: 841.89 } as const

const encoder = new TextEncoder()

/**
 * JPEG の画像を 1 枚ずつ A4 縦のページいっぱいに置いた PDF。画像の縦横の比はページに合わせて作っておく。
 * 中身は、カタログ、ページの一覧、ページごとに（ページ、画像、描く命令）の順のオブジェクト
 */
export function jpegPagesToPdf(pages: readonly PdfPageImage[], size: { width: number; height: number } = A4_POINTS): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, body: () => void) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  const w = size.width.toFixed(2)
  const h = size.height.toFixed(2)

  // バイナリが入っていることを読み手に知らせる行（%と 128 以上の 4 バイト）
  push('%PDF-1.4\n%âãÏÓ\n')
  const pageIds = pages.map((_, index) => 3 + index * 3)
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  object(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((page, index) => {
    const pageId = pageIds[index]
    const imageId = pageId + 1
    const contentId = pageId + 2
    object(pageId, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    )
    object(imageId, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      )
      push(page.jpeg)
      push('\nendstream')
    })
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im${index} Do Q`
    object(contentId, () => push(`<< /Length ${encoder.encode(draw).length} >>\nstream\n${draw}\nendstream`))
  })

  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const pdf = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    pdf.set(chunk, at)
    at += chunk.length
  }
  return pdf
}
