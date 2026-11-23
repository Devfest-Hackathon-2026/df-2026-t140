import { translate as t } from '../../../shared/lib/language.ts'
// 旅の合言葉。招待リンクの代わりに、ホームで入れて旅に参加するための短い文字列（企画書「ユーザー体験」1）。
// Functions 側の同じ決まりは functions/src/domain/joinCode.ts。片方を変えたら、もう片方も合わせる。
// 本番のアプリ全体を守る合言葉とは別のもの。

export const JOIN_CODE_LENGTH = 6

/** 使う文字。見分けにくい 0・O・1・I は使わない */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 人が入れた合言葉を、保存してある形にそろえる。全角と小文字を直し、空白とハイフンを除く。
 * 合言葉の形にならなければ null
 */
export function normalizeJoinCode(input: string): string | null {
  const code = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐‑–—ー]/g, '')
  const valid = code.length === JOIN_CODE_LENGTH && [...code].every((letter) => JOIN_CODE_ALPHABET.includes(letter))
  return valid ? code : null
}

/** 入れた合言葉がおかしければ、その理由。よければ null */
export function joinCodeProblem(input: string): string | null {
  if (input.trim().length === 0) return t('旅の合言葉を入れてください。', 'Enter the trip code.')
  if (!normalizeJoinCode(input)) return t(
    `旅の合言葉は英数字 ${JOIN_CODE_LENGTH} 文字です。0・O・1・I は使いません。`,
    `Enter a ${JOIN_CODE_LENGTH}-character code using letters and numbers. It does not contain 0, O, 1, or I.`,
  )
  return null
}
