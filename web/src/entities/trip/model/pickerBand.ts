import { distanceKm } from './distance.ts'
import { translate as t } from '../../../shared/lib/language.ts'
import type { LatLng } from './regionCenter'

// 大まかな場所を選ぶ画面（旅をつくる、#373。案M）の、上の帯の中身と、サイコロの光の跳ね方。画面の部品から分けた計算

/** 帯に出す 2 行。picked は、行き先を選んだあと（大きい字を緑にする） */
export interface PickerBand {
  sub: string
  main: string
  picked: boolean
}

export interface PickerBandInput {
  /** サイコロで光っている地方の名前（ふっているあいだ） */
  rolling: string | null
  /** サイコロで止まった地方の名前（少しのあいだ「〇〇に決まり！」と出す） */
  landed: string | null
  /** 行き先（地方をまるごと選んだら地方、県だけなら県）の名前と位置 */
  places: readonly { name: string; point: LatLng }[]
  /** 選んだ場所をまとめた名前（pickedLabel）。何も選んでいなければ空 */
  label: string
  /** すべての県を選んだか */
  all: boolean
  /** 出発地の名前と位置（位置が分からなければ null） */
  origin: string
  home: LatLng | null
  title: string
  startDate: string
  endDate: string | null
}

/** 「3/20〜22」「3/31〜4/2」「3/20」（日帰り） */
export function tripDatesLabel(start: string, end: string | null): string {
  const [, sm, sd] = start.split('-').map(Number)
  if (!end || end === start) return `${sm}/${sd}`
  const [, em, ed] = end.split('-').map(Number)
  return em === sm ? `${sm}/${sd}〜${ed}` : `${sm}/${sd}〜${em}/${ed}`
}

/**
 * 上の帯に出すもの。ふっている → 止まった → 選んだ → まだ選んでいない、の順に見る。
 * 行き先が 4 つ以上なら「北海道・東北 +7」のように縮める（帯からはみ出さないように）。距離は、いちばん遠い行き先までのまっすぐな距離
 */
export function pickerBand(input: PickerBandInput): PickerBand {
  const { rolling, landed, places, label, all, origin, home } = input
  if (rolling) return { sub: t('サイコロをふっています…', 'Rolling…'), main: t(`${rolling}？`, `${rolling}?`), picked: false }
  if (landed) return { sub: t('サイコロの目は…', 'The dice picked…'), main: t(`${landed}に決まり！`, `Off to ${landed}!`), picked: false }
  if (label) {
    const names = places.length > 3 && !all ? `${places[0].name}${t('・', ', ')}${places[1].name} +${places.length - 2}` : label
    const far = home ? Math.max(0, ...places.map((place) => distanceKm(home, place.point))) : 0
    const km = Math.round(far / 10) * 10
    const sub = far >= 1 ? t(`${origin}から 約${km}km`, `About ${km} km from ${origin}`) : origin ? t(`${origin}から`, `From ${origin}`) : ''
    return { sub, main: t(`${names}へ`, `Off to ${names}`), picked: true }
  }
  return {
    sub: `${input.title || t('新しい旅', 'New trip')}${t('・', ' · ')}${tripDatesLabel(input.startDate, input.endDate)}`,
    main: t('どこへ行こう？', 'Where should we go?'),
    picked: false,
  }
}

/** サイコロの光が跳ねる回数。だんだん遅くして、最後に止まった地方を選ぶ */
export const ROLL_STEPS = 13

/**
 * サイコロの光の跳ね方。光る地方と、ふり始めてからの時間（ms）を順に並べる。最後は必ず target に止まる。
 * 同じ地方に続けて止まらない。だんだん間をあける。random は 0 以上 1 未満を返す関数
 */
export function rollHops<T>(ids: readonly T[], target: T, steps: number, random: () => number): { id: T; at: number }[] {
  const hops: { id: T; at: number }[] = []
  let at = 0
  let last: T | null = null
  for (let step = 0; step < steps; step += 1) {
    let id = target
    if (step < steps - 1) {
      const others = ids.filter((item) => item !== last)
      id = others[Math.floor(random() * others.length)]
    }
    last = id
    at += 55 + step * step * 4
    hops.push({ id, at })
  }
  return hops
}
