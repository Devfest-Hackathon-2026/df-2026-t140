// しおりビュー（S14）と書き出し（PDF、Google カレンダー）に出す、しおりの中身。
// 今のしおり（しおりのルート、建った場所、メンバー、やりたいこと）から、開くたびに作る（shioriBookOf）。
// 2026-11-20 までは、発案者がしおりを確定したときに Functions が旅のデータ（finalShiori）へ写したものを読んでいた。
// 確定をやめたので、その写しはもう読まない（前に確定した旅のデータには残っている）
import { appLanguage, translate } from '../../../shared/lib/language.ts'
import { originDisplayName } from './originPlaces.ts'

/** しおりの 1 行。しおりの行（entities/route の RouteStop）に、場所と人の情報を足したもの */
export interface ShioriBookStop {
  /** 1 日目が 1 */
  day: number
  /** HH:MM。時刻の分からない集合場所の行は空 */
  time: string
  /** 集合場所など、ピンのない行は null */
  pinId: string | null
  /**
   * 行の ID。同じ場所を何度も訪れるしおりで、複製した行（2 回目からの訪問）にだけある（「ピンの ID~番号」。entities/route の stopIdOf と同じ決め）。
   * ない行の ID は、ピンの ID。時刻を直す、区間の手段を引くときは、行の ID で指す
   */
  stopId?: string
  name: string
  nameEn?: string
  stayMinutes: number
  /** 次の行までの移動時間（保存してある目安）。最後の行は null */
  moveMinutesToNext: number | null
  /** 行の種類。泊まる夜の宿に決まった建物の行は lodging（食事などを足す作業で増える。ほかの行にはない） */
  kind?: string
  /** 集合時間（HH:MM）。集合場所の行だけにある（time は出発時間）。前の形の行にはない */
  meetTime?: string
  /** 場所の種類（entities/pin の PinCategory の値）。ピンのない行は null */
  category: string | null
  /** その場所を希望した人（今の名前と色） */
  wisher: { name: string; color: string } | null
  /** もとになったやりたいこと */
  wishText: string | null
}

/** しおりビューと書き出しに出す、しおりの中身 */
export interface ShioriBook {
  title: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD。null は日帰り */
  endDate: string | null
  origin: string
  members: { name: string; color: string }[]
  /** 1 日目の先頭は集合場所の行 */
  stops: ShioriBookStop[]
  /** 宿を取らない夜（何日目の夜か。1 日目の夜が 1）と、書いた過ごし方（書いていなければ null）。前の形の中身にはない */
  nightsOff?: NightOff[]
}

/** 宿を取らない夜 1 つ。night は何日目の夜か（1 日目の夜が 1）。note は「自分で書く」で書いた過ごし方（車中泊など）。書いていなければ null */
export interface NightOff {
  night: number
  note: string | null
}

/** しおりの行（entities/route の RouteStop と同じ形。層の決まりで、ほかの entities は読まない） */
interface BookStopSource {
  day: number
  time: string
  pinId: string | null
  stopId?: string
  name: string
  stayMinutes: number
  moveMinutesToNext: number | null
  meetTime?: string
}

/** しおりに写すのに要る、建った場所の情報（entities/pin の Pin の一部） */
export interface BookPlace {
  id: string
  nameEn?: string
  category: string
  /** 希望を書いた人 */
  uid: string
  wishId: string
}

/** entities/member の Member の一部 */
export interface BookMember {
  id: string
  displayName: string
  color: string
}

/** entities/wish の Wish の一部 */
export interface BookWish {
  id: string
  text: string
}

/**
 * しおりの行の先頭に、集合場所の行を足す。1 日目にもう出発の行（ピンのない行）があれば、そのまま。
 * 出発地の位置が分からない旅は、Functions が出発の行を入れないので、時刻なしの行を足す（entities/route の withOriginStop と同じ決め）
 */
function withOriginStop(schedule: readonly BookStopSource[], origin: string): readonly BookStopSource[] {
  const first = schedule[0]
  if (!origin || !first || schedule.some((stop) => stop.pinId === null && stop.day === first.day)) return schedule
  return [{ day: first.day, time: '', pinId: null, name: `${origin} 出発`, stayMinutes: 0, moveMinutesToNext: null }, ...schedule]
}

/**
 * 今のしおりから、しおりビューと書き出しに出す中身を作る。しおりの行をそのまま写し、場所の種類、希望した人の名前と色、やりたいことを足す。
 * lodgingIds は、泊まる夜の宿に決まった建物の、行の ID（entities/route の lodgingStopIds。ふつうはピンの ID と同じ）。その行に宿の印（kind: 'lodging'）を付け、書き出しで「宿泊」と書く。
 * nightsOff は、宿を取らない夜（entities/route の lodgingNights のうち skip のもの）。日ごとの欄（shioriBookDays の nightOff）として、その日の最後に出す。
 * schedule には、保存してあるしおりの行を渡す（Routes の時間で差し替えた行は渡さない。Maps の内容は PDF やカレンダーへ持ち出せないため）
 */
export function shioriBookOf(
  trip: { title: string; startDate: string; endDate: string | null; origin: string },
  schedule: readonly BookStopSource[],
  places: readonly BookPlace[],
  members: readonly BookMember[],
  wishes: readonly BookWish[],
  lodgingIds: readonly string[] = [],
  nightsOff: readonly NightOff[] = [],
): ShioriBook {
  const placeOf = new Map(places.map((place) => [place.id, place]))
  const memberOf = new Map(members.map((member) => [member.id, member]))
  const wishOf = new Map(wishes.map((wish) => [wish.id, wish]))
  const stops = withOriginStop(schedule, trip.origin).map((stop): ShioriBookStop => {
    const place = stop.pinId ? placeOf.get(stop.pinId) : undefined
    const wisher = place ? memberOf.get(place.uid) : undefined
    return {
      ...stop,
      ...(place?.nameEn ? { nameEn: place.nameEn } : {}),
      ...(stop.pinId && lodgingIds.includes(stop.stopId ?? stop.pinId) ? { kind: 'lodging' } : {}),
      category: place?.category ?? null,
      wisher: wisher ? { name: wisher.displayName, color: wisher.color } : null,
      wishText: place ? (wishOf.get(place.wishId)?.text ?? null) : null,
    }
  })
  return {
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    origin: trip.origin,
    members: members.map((member) => ({ name: member.displayName, color: member.color })),
    stops,
    ...(nightsOff.length > 0 ? { nightsOff: nightsOff.map((item) => ({ night: item.night, note: item.note })) } : {}),
  }
}

/** しおりに、建った場所の行があるか（なければ、しおりビューには「まだありません」を出し、書き出しは押せない） */
export function shioriBookHasPlaces(book: Pick<ShioriBook, 'stops'>): boolean {
  return book.stops.some((stop) => stop.pinId !== null)
}

/**
 * Google マップで道順を開くときに渡す、場所の名前（しおりの順）。集合場所など、ピンのない行は入れない
 */
export function shioriBookPlaceNames(book: Pick<ShioriBook, 'stops'>): string[] {
  return book.stops.filter((stop) => stop.pinId !== null).map((stop) => stop.name)
}

/**
 * 画面と PDF に出す 1 行。
 * origin：集合場所。place：建った場所。other：食事・宿など、ピンのないほかの行（今のしおりにはまだない）
 */
export interface ShioriRow {
  kind: 'origin' | 'place' | 'other'
  /** 建った場所のピンの ID。ピンのない行は null */
  pinId: string | null
  /**
   * 行の ID。同じ場所を何度も訪れるしおりで、複製した行（2 回目からの訪問）にだけある（「ピンの ID~番号」。entities/route の stopIdOf と同じ決め）。
   * ない行の ID は、ピンの ID。時刻を直す、区間の手段を引くときは、行の ID で指す
   */
  stopId?: string
  /** 集合場所の行は出発時間、場所の行は着く時刻。分からなければ空 */
  time: string
  /** 集合時間。集合場所の行で時刻が分かるときだけ（前の形の行は、出発の 15 分前）。ほかの行は null */
  meetTime: string | null
  name: string
  category: string | null
  wisher: { name: string; color: string } | null
  wishText: string | null
  stayMinutes: number
  moveMinutesToNext: number | null
  /** 泊まる夜の宿に決まった建物の行か（滞在の長さの代わりに「宿泊」と書く） */
  lodging: boolean
}

/** 日ごとの行。date は YYYY-MM-DD */
export interface ShioriDay {
  day: number
  date: string
  rows: ShioriRow[]
  /**
   * その日の夜は宿を取らないときの、その日の最後に出す過ごし方。name は書いた過ごし方（書いていなければ「宿は取らない」）、
   * sub は書いたときだけ「宿は取らない」。宿を取らない夜でなければ null。
   * 行（rows）には混ぜない（Google カレンダーの書き出しは、行の番号から予定の ID を作るので、行が増えると前に入れた予定と ID がずれる）
   */
  nightOff: { name: string; sub: string | null } | null
}

/** 宿を取らない夜に、過ごし方を書いていないときの言葉（地図のしおりの宿の枠と同じ） */
export const NIGHT_OFF_LABEL = translate('宿は取らない', 'No lodging')

function nightOffOf(book: Pick<ShioriBook, 'nightsOff'>, day: number): ShioriDay['nightOff'] {
  const item = book.nightsOff?.find((night) => night.night === day)
  if (!item) return null
  return item.note ? { name: item.note, sub: NIGHT_OFF_LABEL } : { name: NIGHT_OFF_LABEL, sub: null }
}

/** shared/lib の addDays と同じ。scripts/web.test.mjs が Node でそのまま読めるよう、別名（@/）の import を使わない */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(year, month - 1, day + days)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** 集合時間がない前の形の行で、出発の何分前を集合時間として出すか。Functions の MEET_LEAD_MINUTES、entities/route の stopTimes.ts と合わせる */
const MEET_LEAD_MINUTES = 15

/** HH:MM の minutes 分前（0 時より前にはしない） */
function earlierClock(time: string, minutes: number): string {
  const [hours, rest] = time.split(':').map(Number)
  const value = Math.max(0, hours * 60 + rest - minutes)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
}

/**
 * しおりを日ごとの行に分ける（1 日目から順）。集合場所の行の名前からは「 出発」を外す。
 * 集合場所の行には、集合時間（meetTime）も入れる（しおりでは集合時間と出発時間を分けて出す）。
 * ピンのない行のうち、1 日目の先頭か、種類が origin の行を集合場所とみなす。
 * 宿を取らない夜は、その日の nightOff に入れる（行のない日の夜は出さない。しおりは行のある日だけを出すため）
 */
export function shioriBookDays(book: Pick<ShioriBook, 'startDate' | 'stops' | 'nightsOff'>): ShioriDay[] {
  const days: ShioriDay[] = []
  book.stops.forEach((stop, index) => {
    const origin = stop.pinId === null && (stop.kind === 'origin' || (index === 0 && !stop.kind))
    const row: ShioriRow = {
      kind: stop.pinId !== null ? 'place' : origin ? 'origin' : 'other',
      pinId: stop.pinId,
      // 複製した行（同じ場所の 2 回目からの訪問）にだけ、行の ID を写す
      ...(stop.stopId ? { stopId: stop.stopId } : {}),
      time: stop.time,
      meetTime: origin && /^\d{2}:\d{2}$/.test(stop.time) ? (stop.meetTime ?? earlierClock(stop.time, MEET_LEAD_MINUTES)) : null,
      name: origin ? originDisplayName(stop.name.replace(/ 出発$/, '')) : (appLanguage === 'en' ? stop.nameEn || stop.name : stop.name),
      category: stop.category,
      wisher: stop.wisher,
      wishText: stop.wishText,
      stayMinutes: stop.stayMinutes,
      moveMinutesToNext: stop.moveMinutesToNext,
      lodging: stop.pinId !== null && stop.kind === 'lodging',
    }
    const last = days[days.length - 1]
    if (last?.day === stop.day) last.rows.push(row)
    else days.push({ day: stop.day, date: addDays(book.startDate, stop.day - 1), rows: [row], nightOff: nightOffOf(book, stop.day) })
  })
  return days
}

/** しおりの PDF のファイル名。ファイル名に使えない文字は全角の下線にする */
export function shioriBookFileName(book: Pick<ShioriBook, 'title'>): string {
  const title =
    Array.from(book.title)
      .map((char) => (char.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(char) ? '＿' : char))
      .join('')
      .trim() || translate('旅', 'Trip')
  return translate(`${title}のしおり.pdf`, `${title} itinerary.pdf`)
}
