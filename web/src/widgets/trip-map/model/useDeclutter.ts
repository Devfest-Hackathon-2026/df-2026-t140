import { useMemo } from 'react'
import type { Member } from '@/entities/member'
import type { Pin } from '@/entities/pin'
import type { WithId } from '@/shared/api'
import { declutter, type DeclutterItem, type DeclutterResult, estimateLabelWidth } from '../lib/declutter'
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
  /** 建物の模型の大きさ（px）。どの建物も、いつもこの大きさ */
  size: number
  /** 選んでいるピン。まとまりの中にあれば代表にする */
  selectedId: string | null
  /** 建ったばかりのピン。まとまりの中にあれば、選んでいるピンの次に代表にする */
  celebratingId: string | null
  /** いまの拡大の度合い */
  zoom: number
}

/**
 * 地図の建物のまとめ方と、名札を出すかを、いまの拡大の度合いで決める（lib/declutter.ts）。
 * 位置と大きさは変えない。どのピンを出すかは呼ぶ側が決める（渡されたピンの見せ方だけを決める）。
 */
export function useDeclutter({ pins, members, orders, size, selectedId, celebratingId, zoom }: Inputs): DeclutterResult {
  return useMemo(() => {
    const items: DeclutterItem[] = pins.map((pin) => {
      const kind = pin.status === 'done' ? 'building' : pin.status === 'building' ? 'site' : 'pin'
      // 名札の顔：建物と候補は希望を書いた人、工事中は建てた人
      const person = members.some((member) => member.id === (kind === 'site' ? pin.builtBy : pin.uid))
      const labelWidth = estimateLabelWidth(pin.name, {
        avatar: person,
        order: kind === 'building' && orders?.[pin.id] !== undefined,
        maxWidth: kind === 'pin' ? PIN_LABEL_MAX : BUILDING_LABEL_MAX,
        extra: kind === 'site' ? SITE_STATE_WIDTH : 0,
      })
      return { id: pin.id, kind, labelWidth, priority: PRIORITY[kind], ...worldPixel(pin.location, zoom) }
    })
    return declutter(items, { size, selectedId, celebratingId, buildingLabels: zoom >= BUILDING_LABEL_MIN_ZOOM })
  }, [pins, members, orders, size, selectedId, celebratingId, zoom])
}
