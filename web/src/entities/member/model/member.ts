import { recall, remember } from '@/shared/lib'

// 長さの上限は firestore.rules と合わせる
export const MEMBER_NAME_MAX = 20

/** 個人の色。地図の旗やアバターに使う。意味のある色（緑・オレンジ・青）とは少しずらしてある */
export const MEMBER_COLORS = [
  '#12806a',
  '#3d4a8f',
  '#c9571e',
  '#7b4fc9',
  '#b8336a',
  '#7a5a2b',
  '#1b7fa8',
  '#a67c00',
] as const

/** 参加した直後の仮の色。人によって決まるので、同じ人はどの旅でも同じ色から始まる */
export function colorForUid(uid: string): string {
  let sum = 0
  for (const char of uid) sum = (sum * 31 + char.charCodeAt(0)) % 9973
  return MEMBER_COLORS[sum % MEMBER_COLORS.length]
}

/** まだ誰も使っていない色。全部使われていたら、いまの色のまま */
export function freeColor(current: string, usedByOthers: readonly string[]): string {
  if (!usedByOthers.includes(current)) return current
  return MEMBER_COLORS.find((color) => !usedByOthers.includes(color)) ?? current
}

/** 表示名に足りないところがあれば、画面に出す文を返す。よければ null */
export function memberNameProblem(displayName: string): string | null {
  const name = displayName.trim()
  if (!name) return '名前を入れてください'
  if (name.length > MEMBER_NAME_MAX) return `名前は ${MEMBER_NAME_MAX} 文字までです`
  return null
}

/** アバターに出す 1 文字 */
export function initialOf(displayName: string): string {
  return Array.from(displayName.trim())[0] ?? '？'
}

const NAME_KEY = 'displayName'

/** 前に使った表示名。次に旅を作る・参加するときの入力欄に入れておく（この端末だけに覚える） */
export function recallMyName(): string {
  return recall(NAME_KEY) ?? ''
}

export function rememberMyName(displayName: string): void {
  remember(NAME_KEY, displayName.trim())
}
