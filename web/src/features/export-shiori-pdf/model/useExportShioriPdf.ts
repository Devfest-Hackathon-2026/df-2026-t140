import { useState } from 'react'
import { loadModel, renderModelSprite } from '@/entities/model3d'
import { type LegMode, ORIGIN_KEY, stopLeaveTime } from '@/entities/route'
import { type ShioriBook, originDisplayName, shioriBookDateText, shioriBookDays, shioriBookFileName } from '@/entities/trip'
import { type Session, useSession } from '@/shared/api'
import { translate, jpegPagesToPdf, monthDayLabel, playSound, saveFile } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { canvasJpeg, svgImage, urlImage } from '../lib/svgImage'
import { type DrawAssets, drawnText, drawShioriPages, type PdfDay, type ShioriColors } from '../lib/drawPages'

/** 描くのに使う、見た目の決まり（app/styles/tokens.css）の名前 */
const COLOR_TOKENS: Record<keyof ShioriColors, string> = {
  text: '--color-text',
  textSub: '--color-text-sub',
  border: '--color-border',
  sunken: '--color-surface-sunken',
  go: '--color-go',
  goSoft: '--color-go-soft',
  routeEdge: '--color-route-edge',
  onColor: '--color-text-on-color',
}

/** 画面の見た目の決まりから、色とフォントを読む */
function readTheme(): Pick<DrawAssets, 'fontFamily' | 'colors'> {
  const style = getComputedStyle(document.documentElement)
  const colors = Object.fromEntries(
    Object.entries(COLOR_TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim() || '#3c3c3c']),
  ) as unknown as ShioriColors
  return { fontFamily: style.getPropertyValue('--font-family').trim() || 'sans-serif', colors }
}

/** しおりに出る字を、フォントの各太さで読み込んでおく（Google Fonts は字の範囲ごとに分かれていて、使う分だけ読む） */
async function loadFonts(fontFamily: string, text: string): Promise<void> {
  if (!document.fonts) return
  await Promise.all([500, 700, 800].map((weight) => document.fonts.load(`${weight} 16px ${fontFamily}`, text).catch(() => [])))
}

/**
 * 建った場所の模型を読み、斜め上から見た絵にする（画面の決まったしおりの行と同じ絵）。ピンの ID → 絵。
 * 読めなかった・描けなかった（WebGL が使えない）場所は入れない（PDF では丸と種類の絵になる）
 */
async function loadModelImages(session: Session, tripId: string, pinIds: readonly string[]): Promise<NonNullable<DrawAssets['models']>> {
  const images: NonNullable<DrawAssets['models']> = {}
  await Promise.all(
    [...new Set(pinIds)].map(async (pinId) => {
      const model = await loadModel(session, tripId, pinId)
      const url = renderModelSprite(model.json)
      if (url) images[pinId] = await urlImage(url).catch(() => undefined)
    }),
  )
  return images
}

/**
 * しおりを PDF にして保存する操作。
 * 端末の中で、ページごとに canvas に描いて JPEG にし、PDF に包む（外へは何も送らない）。
 * iconMarkup は、場所の種類ごとのアイコンの SVG（ui が画面に描いたものを渡す）。
 * 建った場所の行には、アイコンの丸の代わりに模型の絵を入れる（Takana の依頼、2026-11-23）。
 * moveModes は、行の ID（集合場所は @origin）→ 次の場所までの手段。場所の行の到着・出発の時刻と合わせて、画面のしおりと同じく書く（Takana の依頼、2026-11-23）
 */
export function useExportShioriPdf(
  tripId: string,
  book: ShioriBook | undefined,
  iconMarkup: () => Record<string, string>,
  moveModes: Readonly<Record<string, LegMode>> = {},
) {
  const session = useSession()
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  async function exportPdf(): Promise<void> {
    if (!book || exporting) return
    setExporting(true)
    try {
      const theme = readTheme()
      const displayBook = { ...book, origin: originDisplayName(book.origin) }
      // 場所の行に出る時刻（着く時刻＋いる時間）と、次の場所までの手段を足す
      const days: PdfDay[] = shioriBookDays(displayBook).map((day) => ({
        ...day,
        rows: day.rows.map((row) => ({
          ...row,
          leaveTime: row.kind === 'place' ? stopLeaveTime(row) : null,
          moveMode: moveModes[row.stopId ?? row.pinId ?? ORIGIN_KEY] ?? null,
        })),
      }))
      const dateText = shioriBookDateText(book)
      const text = { dateText, dateLabel: monthDayLabel }
      await loadFonts(theme.fontFamily, drawnText(displayBook, days, text))
      const icons: DrawAssets['icons'] = {}
      await Promise.all(
        Object.entries(iconMarkup()).map(async ([name, markup]) => {
          // ほかの行と移動の手段の絵は灰色、丸の中の絵は白
          const sub = name === 'other' || name.startsWith('mode-')
          icons[name] = await svgImage(markup, sub ? theme.colors.textSub : theme.colors.onColor).catch(() => undefined)
        }),
      )
      const placeIds = days.flatMap((day) => day.rows).flatMap((row) => (row.kind === 'place' && row.pinId ? [row.pinId] : []))
      const models = await loadModelImages(session, tripId, placeIds)
      const canvases = drawShioriPages(displayBook, days, text, { ...theme, icons, models }, () => document.createElement('canvas'))
      const pages = await Promise.all(canvases.map(async (canvas) => ({ jpeg: await canvasJpeg(canvas), width: canvas.width, height: canvas.height })))
      const pdf = jpegPagesToPdf(pages)
      await saveFile(new Blob([pdf], { type: 'application/pdf' }), shioriBookFileName(book))
      playSound('send')
    } catch {
      playSound('error')
      toast(translate('PDF を作れませんでした。もう一度試してください', "Couldn't create the PDF. Try again."))
    } finally {
      setExporting(false)
    }
  }

  return { exportPdf, exporting }
}
