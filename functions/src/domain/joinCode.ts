// 旅の合言葉。招待リンクの代わりに、ホームで入れて旅に参加するための短い文字列（企画書「ユーザー体験」1）。
// 画面側の同じ決まりは web/src/entities/trip/model/joinCode.ts。片方を変えたら、もう片方も合わせる。
// 本番のアプリ全体を守る合言葉（AI_PASSPHRASE、features/unlock-ai）とは別のもの。
//
// Firestore の置き場
//   trips/{tripId}.joinCode  その旅の合言葉。書くのは Functions だけ（メンバーは読める）
//   joinCodes/{合言葉}        合言葉から旅を引く。{ tripId, createdAt }。端末からは読み書きできない
//   joinCodeAttempts/{uid}   間違えた回数。端末からは読み書きできない

/** 合言葉から旅を引く置き場 */
export const JOIN_CODES_COLLECTION = 'joinCodes'

/** 合言葉を間違えた記録の置き場 */
export const JOIN_CODE_ATTEMPTS_COLLECTION = 'joinCodeAttempts'

export const JOIN_CODE_LENGTH = 6

/** 使う文字。見分けにくい 0・O・1・I は使わない（32 文字。6 文字で約 10 億通り） */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 保存してある合言葉として正しい形か */
export function isJoinCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === JOIN_CODE_LENGTH &&
    [...value].every((letter) => JOIN_CODE_ALPHABET.includes(letter))
  )
}

/**
 * 人が入れた合言葉を、保存してある形にそろえる。全角と小文字を直し、空白とハイフンを除く。
 * 合言葉の形にならなければ null
 */
export function normalizeJoinCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > JOIN_CODE_LENGTH * 4) return null
  const code = input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐‑–—ー]/g, '')
  return isJoinCode(code) ? code : null
}

/** 新しい合言葉。random は 0 以上 max 未満の整数を返す（推測できない乱数を渡す） */
export function newJoinCode(random: (max: number) => number): string {
  let code = ''
  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    code += JOIN_CODE_ALPHABET[random(JOIN_CODE_ALPHABET.length)]
  }
  return code
}
