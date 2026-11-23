/**
 * 作ったファイルを端末に保存する。
 * スマホ（指で操作する端末）で、ファイルを共有できるときは共有のシートを出す（「ファイルに保存」や LINE に送るなどを選べる）。
 * それ以外は、ダウンロードとして保存する。共有のシートを閉じた（やめた）ときは、何もしない
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: blob.type })
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  if (touch && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      // 共有できなかったら、ダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // すぐ消すと、ダウンロードが始まる前に URL が無効になるブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
