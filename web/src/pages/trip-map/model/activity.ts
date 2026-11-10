import type { Member } from '@/entities/member'
import { candidatesOfWish, type Pin } from '@/entities/pin'
import type { Wish } from '@/entities/wish'
import type { WithId } from '@/shared/api'

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

/**
 * さがし中と見なす時間。本物の Gemini（agy）は 1 回 20〜40 秒が普通だが、長いと 1 回 150 秒まで待ち、
 * 形が違えば 1 回やり直す。その 2 回分（300 秒）と、関数の打ち切り時間（functions の suggest-places、330 秒）に合わせる
 */
const SEARCH_TIMEOUT_MS = 330_000

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
    const quoted = `「${shorten(wish.text)}」`
    const at = wish.createdAt.toDate()
    // さがし始めてから長くたったものは、途中で止まったとみなす（いつまでも「さがし中」にしない）
    const busy =
      (wish.status === 'pending' || wish.status === 'searching') && now.getTime() - at.getTime() < SEARCH_TIMEOUT_MS
    const text =
      wish.status === 'done' ? `${quoted}にピン ${wishPins.length}` : busy ? `${quoted}をさがし中…` : `${quoted}は見つからず`
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
    const name = shorten(pin.name)
    items.push({
      key: `pin-${pin.id}-${pin.status}`,
      member: pin.builtBy ? memberOf(pin.builtBy) : undefined,
      text: pin.status === 'building' ? `${name}を建築中…` : pin.status === 'done' ? `${name}が建った` : `${name}の建築に失敗`,
      at: pin.updatedAt.toDate(),
      busy: pin.status === 'building',
      pinIds: [pin.id],
    })
  }
  if (items.length === 0) return null
  return items.reduce((latest, item) => (item.at.getTime() >= latest.at.getTime() ? item : latest))
}
