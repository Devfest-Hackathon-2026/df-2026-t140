import type { CatalogueEntry } from '../../domain/catalogue'
import type { LatLng, Pin } from '../../domain/pin'
import { distanceKm, estimateMinutes, stayMinutesFor, type StyleTiming } from '../../domain/routePlan'
import { type DaySlack, FILL_MIN_MINUTES, KEEP_SLACK_MINUTES } from '../../domain/slack'
import { groundMode, type TravelMode } from '../../domain/travelMode'

// しおりの空いた時間への提案を選ぶ純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/stay-by-category.test.mjs）。

/** 空きの近くの場所から、これより遠い場所は提案しない（km。実装した AI が仮に選んだ） */
export const FILLER_RADIUS_KM = 40

/** 立てる提案の候補 1 つ */
export interface FillerDraft {
  /** ピンの ID。日と見本の一覧の何番目かで決まるので、同じ提案を 2 回立てても増えない */
  id: string
  day: number
  entry: CatalogueEntry
}

/** 今ある、まだ「無視」も建築もされていない提案の候補 */
export interface OpenFiller {
  id: string
  day: number
  name: string
  category: Pin['category']
  location: LatLng
}

export interface FillerInput {
  /** 日ごとの空いた時間（domain/slack.ts の daySlacks） */
  slacks: readonly DaySlack[]
  /** ピンの ID から位置（空きの近くの場所の位置を引く） */
  locationOf: (pinId: string) => LatLng | undefined
  /** 旅のピンの名前すべて（候補、建物、無視した提案も）。同じ名前の場所は提案しない */
  takenNames: ReadonlySet<string>
  /** 旅の地方で絞った県（domain/region.ts の allowedPrefectures）。null なら絞らない */
  allowed: ReadonlySet<string> | null
  catalogue: readonly CatalogueEntry[]
  /** しおりの時間の決め（いる時間の目安に使う） */
  timing: StyleTiming
  /** 旅全体の移動手段（移動の見積もりに使う） */
  travelMode: TravelMode
  /** 今ある提案の候補 */
  open: readonly OpenFiller[]
  /** 提案を立ててよいか（旅程が確定していない、建物が上限に達していない、しおりがある） */
  enabled: boolean
}

/** 空き（slack）に、その場所（いる時間と、空きの近くの場所からの行き帰り）を入れても、ゆとりが残るか */
function fits(slack: DaySlack, anchor: LatLng, place: { name: string; category: Pin['category']; location: LatLng }, input: FillerInput): boolean {
  if (distanceKm(anchor, place.location) > FILLER_RADIUS_KM) return false
  const move = estimateMinutes(anchor, place.location, groundMode(input.travelMode))
  return stayMinutesFor(place, input.timing) + move * 2 + KEEP_SLACK_MINUTES <= slack.minutes
}

/**
 * 立てる提案と、消す提案を決める（企画書、#520。Takana の決定、2026-11-21）。
 * - 提案するのは、空きが FILL_MIN_MINUTES（2 時間）以上ある日だけ。1 日に 1 つ
 * - 場所は見本の場所の一覧から選ぶ（Gemini も Maps も呼ばない。費用なし）。宿は選ばない（宿は宿の枠で探す）
 * - 空きの近くの場所から FILLER_RADIUS_KM 以内で、いる時間と行き帰りを入れても 1 日にゆとりが KEEP_SLACK_MINUTES（1 時間）残るもののうち、いちばん近いもの
 * - 旅のピンと同じ名前の場所（無視した提案も）と、旅の地方の外の場所は選ばない
 * - 今ある提案がその日にまだ入るなら、そのまま残す（開くたびに提案が入れ替わらないように）。入らなくなった提案と、空きのなくなった日の提案は消す
 */
export function planFillers(input: FillerInput): { create: FillerDraft[]; remove: string[] } {
  const keep = new Set<string>()
  const create: FillerDraft[] = []
  const chosen = new Set<string>()
  if (input.enabled) {
    for (const slack of input.slacks) {
      if (slack.minutes < FILL_MIN_MINUTES || !slack.anchorPinId) continue
      const anchor = input.locationOf(slack.anchorPinId)
      if (!anchor) continue
      const current = input.open.find((filler) => filler.day === slack.day && !keep.has(filler.id) && fits(slack, anchor, filler, input))
      if (current) {
        keep.add(current.id)
        chosen.add(current.name)
        continue
      }
      let best: { index: number; km: number } | null = null
      input.catalogue.forEach((entry, index) => {
        if (entry.category === 'lodging' || input.takenNames.has(entry.name) || chosen.has(entry.name)) return
        if (input.allowed && !input.allowed.has(entry.pref)) return
        const place = { name: entry.name, category: entry.category, location: { lat: entry.lat, lng: entry.lng } }
        if (!fits(slack, anchor, place, input)) return
        const km = distanceKm(anchor, place.location)
        if (!best || km < best.km - 1e-9) best = { index, km }
      })
      if (!best) continue
      const { index } = best as { index: number; km: number }
      const entry = input.catalogue[index]
      chosen.add(entry.name)
      create.push({ id: fillerPinId(slack.day, index), day: slack.day, entry })
    }
  }
  return { create, remove: input.open.filter((filler) => !keep.has(filler.id)).map((filler) => filler.id) }
}

/** 提案の候補のピンの ID（「filler-2-37」：2 日目、見本の一覧の 37 番目） */
export function fillerPinId(day: number, index: number): string {
  return `filler-${day}-${index}`
}
