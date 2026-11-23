import { useMemo } from 'react'
import type { Member } from '@/entities/member'
import { pinDisplayName, CANDIDATE_PIN_WIDTH, isPastCandidate, NAMED_PIN_WIDTH, PAST_PIN_WIDTH, type Pin } from '@/entities/pin'
import type { WithId } from '@/shared/api'
import { buildingSizes, declutter, type DeclutterItem, type DeclutterResult, estimateLabelWidth, zoomedSize } from '../lib/declutter'
import { worldPixel } from '../lib/mercator'

/** 名札の最大の幅（ui/MapPin.module.css、ui/MapBuilding.module.css の max-width） */
const PIN_LABEL_MAX = 170
const BUILDING_LABEL_MAX = 190
/** 工事中の名札の「建築中」の札の幅 */
const SITE_STATE_WIDTH = 52

const PRIORITY = { building: 3, site: 2, pin: 1 } as const

/**
 * 建物の名札を出す、いちばん引いた拡大の度合い。これより引いたら、どの建物の名札も出さない
 * （Takana の依頼：最大の拡大の近くだけ出す。13 は市街地が見えるくらいで、仮に決めた値）
 */
export const BUILDING_LABEL_MIN_ZOOM = 13

interface Inputs {
  /** 地図に出すピン（どれを出すかは呼ぶ側が決める） */
  pins: readonly WithId<Pin>[]
  members: readonly WithId<Member>[]
  /** 回る順番。名札に番号が付くぶん、幅が広がる */
  orders: Record<string, number> | undefined
  /** 建物の模型の基準の大きさ（px。市街地のあたりで描く大きさ）。拡大の度合いとまわりの混み具合で変える（lib/declutter.ts の buildingSizes） */
  size: number
  /** 地図の幅（px）。いちばん寄ったときの、まわりに建物がない建物の大きさを決める */
  mapWidth: number
  /** 選んでいるピン。まとまりの中にあれば代表にする */
  selectedId: string | null
  /** 建ったばかりのピン。まとまりの中にあれば、選んでいるピンの次に代表にする */
  celebratingId: string | null
  /** いまの拡大の度合い */
  zoom: number
  /** いちばん新しい検索。渡したときだけ、ほかの検索の候補を灰色の小さいピン（名札なし、いちばん後回し）として並べる */
  currentWishId?: string | null
}

export interface MapLayout extends DeclutterResult {
  /** 建物ごとの、描く大きさ（px）。建物（完成したピン）だけが入っている */
  sizes: Record<string, number>
  /** いまの拡大の度合いでの基準の大きさ（px）。sizes にない建物に使う */
  baseSize: number
}

/**
 * 地図の建物の大きさとまとめ方と、名札を出すかを、いまの拡大の度合いで決める（lib/declutter.ts）。
 * 位置は変えない。どのピンを出すかは呼ぶ側が決める（渡されたピンの見せ方だけを決める）。
 */
export function useDeclutter({ pins, members, orders, size, mapWidth, selectedId, celebratingId, zoom, currentWishId }: Inputs): MapLayout {
  return useMemo(() => {
    const items: DeclutterItem[] = pins.map((pin) => {
      const kind = pin.status === 'done' ? 'building' : pin.status === 'building' ? 'site' : 'pin'
      // 名札の顔：建物と候補は希望を書いた人、工事中は建てた人
      const person = members.some((member) => member.id === (kind === 'site' ? pin.builtBy : pin.uid))
      const labelWidth = estimateLabelWidth(pinDisplayName(pin), {
        avatar: person,
        order: kind === 'building' && orders?.[pin.id] !== undefined,
        maxWidth: kind === 'pin' ? PIN_LABEL_MAX : BUILDING_LABEL_MAX,
        extra: kind === 'site' ? SITE_STATE_WIDTH : 0,
      })
      const named = kind === 'pin' && pin.namedMatch
      // 前の検索の候補は名札を出さず、小さいピンで、ほかの印に場所をゆずる（選んでいるときは、ふつうのピンと同じ）
      const past = currentWishId !== undefined && pin.id !== selectedId && isPastCandidate(pin, currentWishId)
      return {
        id: pin.id,
        kind,
        labelWidth: past ? 0 : labelWidth,
        priority: past ? 0 : named ? 4 : PRIORITY[kind],
        pinWidth: past ? PAST_PIN_WIDTH : named ? NAMED_PIN_WIDTH : CANDIDATE_PIN_WIDTH,
        ...worldPixel(pin.location, zoom),
      }
    })
    const baseSize = zoomedSize(size, zoom)
    const sizes = buildingSizes(
      items.filter((item) => item.kind === 'building'),
      { base: size, zoom, mapWidth },
    )
    const result = declutter(items, { size: baseSize, sizes, selectedId, celebratingId, buildingLabels: zoom >= BUILDING_LABEL_MIN_ZOOM })
    return { ...result, sizes, baseSize: Math.round(baseSize) }
  }, [pins, members, orders, size, mapWidth, selectedId, celebratingId, zoom, currentWishId])
}
