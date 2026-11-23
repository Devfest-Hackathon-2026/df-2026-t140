import { translate } from '../../../shared/lib/language.ts'
import type { ShioriDay, ShioriRow, ShioriBook } from '@/entities/trip'

// しおりを、A4 縦のページの絵（canvas）に描く。PDF にするのは model（useExportShioriPdf）。
// 画面のしおり（丸い地点を太い線でつなぐ）と同じ見た目にする。場所の行の時刻は「到着」「出発」の 2 段、行の下に移動の手段と目安の時間（Takana の依頼、2026-11-23）。
// 地図の絵、Routes の時間、Places の写真、天気は入れない。
// 長さは CSS の px（A4 を 96 dpi で 794 × 1123）で考え、SCALE 倍の画素で描く。

/** ページの大きさ（px）と、描くときの倍率。150 dpi ほどになる */
export const PAGE = { width: 794, height: 1123 } as const
export const SCALE = 2

const MARGIN_X = 56
const MARGIN_TOP = 56
/** 下の余白。ページ番号の行が入る */
const MARGIN_BOTTOM = 72
const CONTENT_WIDTH = PAGE.width - MARGIN_X * 2

/** 地点の丸の大きさと、行の並び（丸、時刻、名前） */
const DOT = 40
const TIME_X = MARGIN_X + DOT + 14
const TEXT_X = TIME_X + 64
/** 集合場所の、札（「集合」「出発」）と時刻の 1 組の高さ */
const TIME_PAIR_HEIGHT = 38
const TEXT_WIDTH = PAGE.width - MARGIN_X - TEXT_X
const ROW_GAP = 10
/** 丸と丸をつなぐ線の太さ */
const LINE = 6
/** 模型の絵の大きさと、丸の上の辺から上へはみ出す分（画面の決まったしおりの .modelSprite と同じ 60px、上へ 14px） */
const MODEL_SIZE = 60
const MODEL_RISE = 14

/** 描くのに使う色（app/styles/tokens.css の値を、画面から読んで渡す） */
export interface ShioriColors {
  text: string
  textSub: string
  border: string
  sunken: string
  go: string
  goSoft: string
  routeEdge: string
  onColor: string
}

export interface DrawAssets {
  fontFamily: string
  colors: ShioriColors
  /** 場所の種類ごとの絵（白い線）。origin は集合場所、other はほかの行の絵 */
  icons: Record<string, CanvasImageSource | undefined>
  /** 建った場所の模型の絵（ピンの ID ごと）。あれば、場所の行の丸の代わりに描く（画面の決まったしおりと同じ。Takana の依頼、2026-11-23） */
  models?: Record<string, CanvasImageSource | undefined>
}

/** 次の場所までの移動の手段（entities/route の LegMode と同じ値）。絵は icons の mode-<手段> */
export type MoveMode = 'transit' | 'car' | 'walk' | 'plane'

/** PDF に描く 1 行。画面のしおりの行に、場所を出る時刻（leaveTime）と、次の場所までの手段（moveMode）を足したもの */
export type PdfRow = ShioriRow & {
  /** 場所を出る時刻（HH:MM。着く時刻＋いる時間）。場所の行で時刻が分かるときだけ */
  leaveTime?: string | null
  /** 次の場所までの手段。分からなければ「次まで移動」と書く */
  moveMode?: MoveMode | null
}

/** PDF に描く 1 日 */
export type PdfDay = Omit<ShioriDay, 'rows'> & { rows: PdfRow[] }

type Weight = 500 | 700 | 800

/** ページに書く決まった言葉 */
const LABELS = {
  app: translate('たびむすび', 'Tabimusubi'),
  badge: translate('しおり', 'Itinerary'),
  origin: translate('集合場所', 'Meeting point'),
  meet: translate('集合', 'Meet'),
  depart: translate('出発', 'Depart'),
  continued: translate('（つづき）', ' (continued)'),
  arrive: translate('到着', 'Arrive'),
  lodging: translate('宿泊', 'Overnight stay'),
  move: translate('次まで移動', 'Travel to next stop'),
  transit: translate('電車・バス', 'Train and bus'),
  car: translate('車', 'Car'),
  walk: translate('徒歩', 'Walk'),
  plane: translate('飛行機', 'Flight'),
  note: translate('時刻と移動の時間は、直線距離から計算したおおよその目安です。', 'Times and travel durations are estimates based on straight-line distances.'),
} as const

/** 1 つのかたまり。ページをまたがない。draw は、ページの上からの位置 top に描く */
interface Block {
  height: number
  /** 日の見出しのあとに続く行か（ページの頭に来たら「つづき」の見出しを足す） */
  day?: ShioriDay
  /** 地点の行なら、丸の中心の y（かたまりの上から）。線でつなぐのに使う */
  dotCenter?: number
  /** 同じ日に次の行があるか（線を下へ伸ばす） */
  linkNext?: boolean
  draw: (ctx: CanvasRenderingContext2D, top: number) => void
}

function font(assets: DrawAssets, size: number, weight: Weight): string {
  return `${weight} ${size}px ${assets.fontFamily}`
}

/** 行の頭に来てはいけない文字（句読点と閉じかっこ） */
const NO_LINE_START = '、。，．・：；？！ー」』）】〉》〕｝]）…'

/** 文字ごとに折り返す（日本語は単語の区切りがないので）。maxLines を超えたら、最後の行を「…」で切る */
export function wrapText(measure: (text: string) => number, text: string, maxWidth: number, maxLines = Infinity): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of Array.from(text)) {
    if (line && measure(line + char) > maxWidth && !NO_LINE_START.includes(char)) {
      lines.push(line)
      line = char
    } else {
      line += char
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last && measure(`${last}…`) > maxWidth) last = Array.from(last).slice(0, -1).join('')
  kept[maxLines - 1] = `${last}…`
  return kept
}

function lines(ctx: CanvasRenderingContext2D, assets: DrawAssets, text: string, size: number, weight: Weight, width: number, maxLines?: number): string[] {
  ctx.font = font(assets, size, weight)
  return wrapText((value) => ctx.measureText(value).width, text, width, maxLines)
}

function fillLines(ctx: CanvasRenderingContext2D, assets: DrawAssets, rows: string[], x: number, top: number, size: number, weight: Weight, color: string, lineHeight: number) {
  ctx.font = font(assets, size, weight)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  rows.forEach((row, index) => ctx.fillText(row, x, top + lineHeight * index + lineHeight / 2))
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, color: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
  ctx.fillStyle = color
  ctx.fill()
}

/** 人の丸（頭文字）と名前。幅を返す */
function personChip(ctx: CanvasRenderingContext2D, assets: DrawAssets, person: { name: string; color: string }, x: number, centerY: number, size: number): number {
  const radius = size / 2
  circle(ctx, x + radius, centerY, radius, person.color)
  ctx.font = font(assets, Math.round(size * 0.5), 800)
  ctx.fillStyle = assets.colors.onColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(Array.from(person.name)[0] ?? '', x + radius, centerY + 1)
  ctx.textAlign = 'left'
  ctx.font = font(assets, Math.round(size * 0.62), 700)
  ctx.fillStyle = assets.colors.text
  ctx.fillText(person.name, x + size + 6, centerY + 1)
  return size + 6 + ctx.measureText(person.name).width
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return translate(`${rest} 分`, `${rest} min`)
  return rest === 0 ? translate(`${hours} 時間`, `${hours} hr`) : translate(`${hours} 時間 ${rest} 分`, `${hours} hr ${rest} min`)
}

/** 表紙のかたまり：アプリの名前、旅のタイトル、日程、集合場所、メンバー */
function coverBlock(ctx: CanvasRenderingContext2D, assets: DrawAssets, book: ShioriBook, dateText: string): Block {
  const { colors } = assets
  const title = lines(ctx, assets, book.title, 32, 800, CONTENT_WIDTH, 3)
  const titleTop = 40
  const titleLine = 44
  const infoTop = titleTop + title.length * titleLine + 10
  // メンバーの並び（折り返す）
  ctx.font = font(assets, 15, 700)
  const chips: { x: number; row: number }[] = []
  let x = MARGIN_X
  let row = 0
  for (const member of book.members) {
    const width = 26 + 6 + ctx.measureText(member.name).width
    if (x > MARGIN_X && x + width > MARGIN_X + CONTENT_WIDTH) {
      x = MARGIN_X
      row += 1
    }
    chips.push({ x, row })
    x += width + 16
  }
  const membersTop = infoTop + 64
  const height = membersTop + (row + 1) * 36 + 24
  return {
    height,
    draw: (context, top) => {
      // アプリの名前と「しおり」の札
      context.font = font(assets, 15, 800)
      context.fillStyle = colors.go
      context.textBaseline = 'middle'
      context.fillText(LABELS.app, MARGIN_X, top + 12)
      const label = LABELS.badge
      context.font = font(assets, 13, 800)
      const labelWidth = context.measureText(label).width + 24
      roundRect(context, MARGIN_X + CONTENT_WIDTH - labelWidth, top, labelWidth, 26, 13, colors.goSoft)
      context.fillStyle = colors.go
      context.fillText(label, MARGIN_X + CONTENT_WIDTH - labelWidth + 12, top + 13)

      fillLines(context, assets, title, MARGIN_X, top + titleTop, 32, 800, colors.text, titleLine)
      fillLines(context, assets, [dateText], MARGIN_X, top + infoTop, 17, 700, colors.textSub, 26)
      const origin = translate(`${LABELS.origin}　${book.origin}`, `${LABELS.origin}: ${book.origin}`)
      fillLines(context, assets, [origin], MARGIN_X, top + infoTop + 28, 17, 700, colors.textSub, 26)
      book.members.forEach((member, index) => {
        const chip = chips[index]
        personChip(context, assets, member, chip.x, top + membersTop + chip.row * 36 + 13, 26)
      })
      // 下の区切りの線
      context.fillStyle = colors.border
      context.fillRect(MARGIN_X, top + height - 4, CONTENT_WIDTH, 2)
    },
  }
}

function dayHeading(assets: DrawAssets, day: ShioriDay, dateLabel: (date: string) => string, continued: boolean): Block {
  return {
    height: 48,
    draw: (context, top) => {
      const label = translate(`${day.day} 日目`, `Day ${day.day}`) + (continued ? LABELS.continued : '')
      context.font = font(assets, 20, 800)
      context.fillStyle = assets.colors.routeEdge
      context.textBaseline = 'middle'
      context.fillText(label, MARGIN_X, top + 28)
      const width = context.measureText(label).width
      context.font = font(assets, 15, 700)
      context.fillStyle = assets.colors.textSub
      context.fillText(dateLabel(day.date), MARGIN_X + width + 12, top + 29)
    },
  }
}

/** 地点の行。丸、時刻、名前、誰のやりたいことか、滞在と次への移動 */
/** 宿を取らない夜の行を、ほかの行（kind: other）の形で描くための中身。sub は名前の下の 1 行 */
type NightOffRow = PdfRow & { nightOffSub: string | null }

/** 宿を取らない夜の行（その日の最後）。画面の決まったしおりと同じく、宿の絵の丸と、書いた過ごし方 */
function nightOffRow(nightOff: NonNullable<ShioriDay['nightOff']>): NightOffRow {
  return {
    kind: 'other',
    pinId: null,
    time: '',
    meetTime: null,
    name: nightOff.name,
    category: 'lodging',
    wisher: null,
    wishText: null,
    stayMinutes: 0,
    moveMinutesToNext: null,
    lodging: false,
    nightOffSub: nightOff.sub,
  }
}

/** 移動の行に書く言葉。画面のしおりと同じ「電車・バスで約 30 分」。手段が分からなければ「次まで移動 30 分」 */
function moveLabel(mode: MoveMode | null | undefined, minutes: number): string {
  const time = durationLabel(minutes)
  if (!mode) return `${LABELS.move} ${time}`
  return translate(`${LABELS[mode]}で約 ${time}`, `${LABELS[mode]} · about ${time}`)
}

/** 移動の行の高さと、絵の大きさ */
const MOVE_HEIGHT = 24
const MOVE_ICON = 16

function rowBlock(ctx: CanvasRenderingContext2D, assets: DrawAssets, row: PdfRow | NightOffRow, linkNext: boolean, day: ShioriDay | undefined): Block {
  const { colors } = assets
  const nightOff = 'nightOffSub' in row
  const minor = row.kind === 'other'
  const nameSize = minor ? 15 : 19
  const name = lines(ctx, assets, row.name, nameSize, minor ? 700 : 800, TEXT_WIDTH, 3)
  const nameLine = minor ? 22 : 27
  // 希望した人の丸と名前の右に、やりたいことを続けて書く（画面のしおりと同じ 1 行）。入らなければ、その幅で折り返す
  ctx.font = font(assets, 12, 700)
  const chipWidth = row.wisher ? 20 + 6 + ctx.measureText(row.wisher.name).width + 10 : 0
  const wishText = translate(`「${row.wishText}」`, `“${row.wishText}”`)
  const wish = row.wishText ? lines(ctx, assets, wishText, 14, 700, TEXT_WIDTH - chipWidth, 2) : []
  const sub = row.kind === 'origin' ? [LABELS.origin] : nightOff && row.nightOffSub ? [row.nightOffSub] : []
  // 宿の行は、画面と同じく名前の下に「宿泊」と書く（下の「出発」は、翌朝に宿を出る時刻）
  const meta = row.kind === 'place' && row.lodging ? LABELS.lodging : ''
  const wishHeight = row.wisher || wish.length > 0 ? Math.max(row.wisher ? 26 : 0, wish.length * 21) : 0
  const textHeight = name.length * nameLine + sub.length * 22 + wishHeight + (meta ? 22 : 0)
  const dot = minor ? 28 : DOT
  // 時刻は札と時刻の 2 段ずつで書く（画面のしおりと同じ）。集合場所は「集合」「出発」、場所の行は「到着」「出発」
  const timePairs = row.meetTime
    ? [[LABELS.meet, row.meetTime], [LABELS.depart, row.time]]
    : row.kind === 'place' && row.time
      ? [[LABELS.arrive, row.time], ...(row.leaveTime ? [[LABELS.depart, row.leaveTime]] : [])]
      : []
  const timeHeight = timePairs.length * TIME_PAIR_HEIGHT
  // 次の場所までの移動の行（画面のしおりと同じく、行の下に、丸をつなぐ線の右に出す）
  const move = row.moveMinutesToNext ? moveLabel(row.moveMode, row.moveMinutesToNext) : ''
  const body = Math.max(dot, textHeight, timeHeight)
  const height = body + (move ? MOVE_HEIGHT : 0) + ROW_GAP * 2
  const dotCenter = ROW_GAP + DOT / 2
  return {
    height,
    day,
    dotCenter,
    linkNext,
    draw: (context, top) => {
      // 丸（希望した人の色。集合場所とほかの行は灰色）と、場所の種類の絵
      const center = top + dotCenter
      // 集合場所は画面のしおりと同じ濃い色
      const color = row.wisher?.color ?? (row.kind === 'origin' ? colors.text : colors.textSub)
      // 建った場所は、丸と種類の絵の代わりに模型の絵（読めなかったときは丸と種類の絵）
      const model = row.kind === 'place' && row.pinId ? assets.models?.[row.pinId] : undefined
      if (model) {
        context.drawImage(model, MARGIN_X + DOT / 2 - MODEL_SIZE / 2, center - DOT / 2 - MODEL_RISE, MODEL_SIZE, MODEL_SIZE)
      } else {
        // 宿を取らない夜は、宿の絵（白い線）が見えるよう、灰色の丸にする
        circle(context, MARGIN_X + DOT / 2, center, dot / 2, nightOff ? colors.textSub : minor ? colors.border : color)
        const icon = assets.icons[nightOff ? 'lodging' : row.kind === 'place' ? (row.category ?? 'town') : row.kind]
        const iconSize = minor ? 16 : 22
        if (icon) context.drawImage(icon, MARGIN_X + DOT / 2 - iconSize / 2, center - iconSize / 2, iconSize, iconSize)
      }

      if (timePairs.length > 0) {
        timePairs.forEach(([tag, time], index) => {
          const pairTop = top + ROW_GAP + index * TIME_PAIR_HEIGHT
          fillLines(context, assets, [tag], TIME_X, pairTop, 11, 700, colors.textSub, 14)
          fillLines(context, assets, [time], TIME_X, pairTop + 14, 17, 800, colors.text, 22)
        })
      } else if (row.time) fillLines(context, assets, [row.time], TIME_X, center - 13, minor ? 15 : 17, 800, minor ? colors.textSub : colors.text, 26)

      let y = top + ROW_GAP + (textHeight < DOT ? (DOT - textHeight) / 2 : 0)
      fillLines(context, assets, name, TEXT_X, y, nameSize, minor ? 700 : 800, minor ? colors.textSub : colors.text, nameLine)
      y += name.length * nameLine
      if (sub.length > 0) {
        fillLines(context, assets, sub, TEXT_X, y, 14, 700, colors.textSub, 22)
        y += 22
      }
      if (row.wisher) personChip(context, assets, row.wisher, TEXT_X, y + 13, 20)
      if (wish.length > 0) fillLines(context, assets, wish, TEXT_X + chipWidth, y + (row.wisher ? 2 : 0), 14, 700, colors.textSub, 21)
      y += wishHeight
      if (meta) fillLines(context, assets, [meta], TEXT_X, y, 13, 700, colors.textSub, 22)

      if (move) {
        const moveTop = top + ROW_GAP + body
        const icon = row.moveMode ? assets.icons[`mode-${row.moveMode}`] : undefined
        let x = TIME_X
        if (icon) {
          context.drawImage(icon, x, moveTop + (MOVE_HEIGHT - MOVE_ICON) / 2, MOVE_ICON, MOVE_ICON)
          x += MOVE_ICON + 6
        }
        fillLines(context, assets, [move], x, moveTop, 13, 700, colors.textSub, MOVE_HEIGHT)
      }
    },
  }
}

function footer(ctx: CanvasRenderingContext2D, assets: DrawAssets, page: number, total: number, last: boolean) {
  const y = PAGE.height - MARGIN_BOTTOM / 2
  ctx.font = font(assets, 12, 700)
  ctx.fillStyle = assets.colors.textSub
  ctx.textBaseline = 'middle'
  ctx.fillText(last ? LABELS.note : LABELS.app, MARGIN_X, y)
  ctx.textAlign = 'right'
  ctx.fillText(`${page} / ${total}`, PAGE.width - MARGIN_X, y)
  ctx.textAlign = 'left'
}

/** ページに書く字のすべて。描く前に、その字のフォントを読み込んでおくのに使う */
export function drawnText(book: ShioriBook, days: readonly PdfDay[], text: { dateText: string; dateLabel: (date: string) => string }): string {
  return [
    ...Object.values(LABELS),
    book.title,
    book.origin,
    text.dateText,
    ...book.members.map((member) => member.name),
    ...days.flatMap((day) => [
      translate(`${day.day} 日目`, `Day ${day.day}`),
      text.dateLabel(day.date),
      ...day.rows.flatMap((row) => [row.time, row.meetTime ?? '', row.leaveTime ?? '', row.name, row.wishText ? translate(`「${row.wishText}」…`, `“${row.wishText}”…`) : '', row.wisher?.name ?? '']),
      day.nightOff?.name ?? '',
      day.nightOff?.sub ?? '',
    ]),
    translate('0123456789 時間分/…約で', '0123456789 hrmin/… · :about'),
  ].join('')
}

/** 置いたかたまり（どのページの、どの高さか） */
interface Placed {
  block: Block
  page: number
  top: number
}

/**
 * かたまりをページに割り付ける。入りきらないかたまりは次のページへ送る。
 * 日の途中でページが変わったら、次のページの頭に「〇日目（つづき）」の見出しを足す
 */
export function paginate<B extends { height: number; day?: ShioriDay }>(blocks: readonly B[], continuedHeading: (day: ShioriDay) => B): { block: B; page: number; top: number }[] {
  const placed: { block: B; page: number; top: number }[] = []
  const bottom = PAGE.height - MARGIN_BOTTOM
  let page = 0
  let y = MARGIN_TOP
  for (const block of blocks) {
    if (y + block.height > bottom && y > MARGIN_TOP) {
      page += 1
      y = MARGIN_TOP
      if (block.day) {
        const heading = continuedHeading(block.day)
        placed.push({ block: heading, page, top: y })
        y += heading.height
      }
    }
    placed.push({ block, page, top: y })
    y += block.height
  }
  return placed
}

/**
 * しおりを、ページごとの canvas に描く。
 * days は shioriBookDays の結果、dateText は表紙の日程（「11/21（土）〜11/22（日）・1泊2日」）、
 * dateLabel は日の見出しの日付（「11/21（土）」）
 */
export function drawShioriPages(
  book: ShioriBook,
  days: readonly PdfDay[],
  text: { dateText: string; dateLabel: (date: string) => string },
  assets: DrawAssets,
  createCanvas: () => HTMLCanvasElement,
): HTMLCanvasElement[] {
  const measureCanvas = createCanvas()
  const measure = measureCanvas.getContext('2d')!
  const manyDays = days.length > 1
  const blocks: Block[] = [coverBlock(measure, assets, book, text.dateText)]
  for (const day of days) {
    if (manyDays) blocks.push(dayHeading(assets, day, text.dateLabel, false))
    day.rows.forEach((row, index) => blocks.push(rowBlock(measure, assets, row, index < day.rows.length - 1 || day.nightOff !== null, manyDays ? day : undefined)))
    // 宿を取らない夜は、その日の最後に、書いた過ごし方の行を足す（#553）
    if (day.nightOff) blocks.push(rowBlock(measure, assets, nightOffRow(day.nightOff), false, manyDays ? day : undefined))
  }
  const placed: Placed[] = paginate(blocks, (day) => dayHeading(assets, day, text.dateLabel, true))
  const total = (placed[placed.length - 1]?.page ?? 0) + 1

  const canvases: HTMLCanvasElement[] = []
  for (let page = 0; page < total; page += 1) {
    const canvas = createCanvas()
    canvas.width = PAGE.width * SCALE
    canvas.height = PAGE.height * SCALE
    const ctx = canvas.getContext('2d')!
    ctx.scale(SCALE, SCALE)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PAGE.width, PAGE.height)
    const onPage = placed.filter((item) => item.page === page)
    // 先に丸と丸をつなぐ線を引き、その上に行を描く。次の行が同じページにあるときだけつなぐ
    onPage.forEach((item, index) => {
      if (item.block.dotCenter === undefined || !item.block.linkNext) return
      const next = onPage.slice(index + 1).find((other) => other.block.dotCenter !== undefined)
      if (!next || next.block.day !== item.block.day) return
      const from = item.top + item.block.dotCenter
      const to = next.top + next.block.dotCenter!
      roundRect(ctx, MARGIN_X + DOT / 2 - LINE / 2, from, LINE, to - from, LINE / 2, assets.colors.border)
    })
    for (const item of onPage) item.block.draw(ctx, item.top)
    footer(ctx, assets, page + 1, total, page === total - 1)
    canvases.push(canvas)
  }
  return canvases
}
