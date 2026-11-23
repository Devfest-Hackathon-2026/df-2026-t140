import { translate } from '@/shared/lib'
import type { Member } from '@/entities/member'
import { pinDisplayName, candidatesOfWish, type Pin } from '@/entities/pin'
import { mealSlotLabel } from '@/entities/route'
import type { Wish } from '@/entities/wish'
import type { WithId } from '@/shared/api'
import { isWishSearching } from './searching'

/**
 * アプリが書いた希望（宿さがし、ごはんのお店さがし）の、選んだ言語での言い方。人が書いた希望は null（書いた文のまま出す）。
 * 希望の文（text）は日本語で共有するので、英語のときは夜や食事の枠から作り直す
 */
export function appWishLabel(wish: Pick<Wish, 'text' | 'lodgingNight' | 'mealSlot'>): string | null {
  if (wish.lodgingNight) return translate(`${wish.lodgingNight} 日目の宿`, `Lodging for day ${wish.lodgingNight}`)
  if (wish.mealSlot) return translate(wish.text, mealSlotLabel(wish.mealSlot) ?? wish.text)
  return null
}

/** 帯の題と場所カードに出す、希望の文。アプリが書いた希望は選んだ言語で、人が書いた希望はそのまま */
export function wishDisplayText(wish: Pick<Wish, 'text' | 'lodgingNight' | 'mealSlot'> | undefined): string | null {
  return wish ? (appWishLabel(wish) ?? wish.text) : null
}

/** 地図の上に 1 つだけ出す、いちばん新しいできごと（「『白馬』にピン・2時間前」） */
export interface Activity {
  key: string
  /** 誰のできごとか。抜けた人なら undefined */
  member: WithId<Member> | undefined
  /** 誰か 1 人のできごとではない。「だれか」と読み上げない */
  shared?: boolean
  text: string
  at: Date
  /** まだ途中（さがしている、建てている） */
  busy: boolean
  /** 関係するピン。押したら、これらが見えるように地図を動かす */
  pinIds: string[]
}

/** 時刻が決まったイベント（花火大会、見学会）を探して、旅の日程のあいだに見つからなかったときの知らせ（#581） */
export const EVENT_NOT_FOUND = translate('この日程のあいだに、この辺りでの開催は見つかりませんでした', 'No event was found around here during your trip dates')

/** 長い文は、帯に収まるように切る */
export function shorten(text: string, max = 12): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text
}

/**
 * いちばん新しいできごとを選ぶ。できごとを足すときは、ここに候補を足して、新しい順で選ぶ。
 */
export function latestActivity(
  wishes: readonly WithId<Wish>[],
  pins: readonly WithId<Pin>[],
  members: readonly WithId<Member>[],
  now: Date,
): Activity | null {
  const memberOf = (uid: string) => members.find((member) => member.id === uid)
  const items: Activity[] = wishes.map((wish) => {
    const wishPins = candidatesOfWish(pins, wish.id)
    const shortWish = shorten(wish.text)
    const at = wish.createdAt.toDate()
    // さがし始めてから長くたったものは、途中で止まったとみなす（いつまでも「さがし中」にしない）
    const busy = isWishSearching(wish, now)
    // 宿さがし（「宿を探す」から書いた希望）は、かぎかっこを付けずに「1 日目の宿を探し中です」と出す。
    // ごはんのお店さがし（「お店を探す」から書いた希望）も同じく、書いた文のまま「1 日目の昼ごはんを探し中です」と出す
    const inn = appWishLabel(wish)
    const quoted = translate(`「${shortWish}」`, `“${shortWish}”`)
    const text = inn
      ? wish.status === 'done'
        ? translate(`${inn}にピン ${wishPins.length}`, `${inn}: ${wishPins.length} found`)
        : busy ? translate(`${inn}を探し中です`, `Searching for ${inn}…`) : translate(`${inn}は見つからず`, `${inn}: nothing found`)
      : wish.status === 'done'
        ? translate(`${quoted}にピン ${wishPins.length}`, `${quoted}: ${wishPins.length} found`)
        : busy
          ? translate(`${quoted}をさがし中…`, `Searching for ${quoted}…`)
          // 時刻が決まったイベントが、旅の日程のあいだに見つからなかった（Takana の決定、2026-11-21、#581）
          : wish.notFound === 'event' ? EVENT_NOT_FOUND : translate(`${quoted}は見つからず`, `No places found for ${quoted}`)
    return {
      key: `wish-${wish.id}-${wish.status}`,
      member: memberOf(wish.uid),
      text,
      at,
      busy,
      pinIds: wishPins.map((pin) => pin.id),
    }
  })
  // 建築：工事中、完成、失敗。時刻はピンが最後に変わったとき
  for (const pin of pins) {
    if (pin.status === 'candidate') continue
    const name = shorten(pinDisplayName(pin))
    items.push({
      key: `pin-${pin.id}-${pin.status}`,
      member: pin.builtBy ? memberOf(pin.builtBy) : undefined,
      text: pin.status === 'building' ? translate(`${name}を建築中…`, `Building ${name}…`) : pin.status === 'done' ? translate(`${name}が建った`, `${name} is ready`) : translate(`${name}の建築に失敗`, `Couldn't build ${name}`),
      at: pin.updatedAt.toDate(),
      busy: pin.status === 'building',
      pinIds: [pin.id],
    })
  }
  if (items.length === 0) return null
  return items.reduce((latest, item) => (item.at.getTime() >= latest.at.getTime() ? item : latest))
}
