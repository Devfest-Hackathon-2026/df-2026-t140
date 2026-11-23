// 旅の季節。旅をつくる画面（S01）で、日程の月から、地図に重ねて舞うもの（紅葉・雪・桜）と答えへの一言を決める

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

/** 日付（YYYY-MM-DD）の季節。3〜5 月は春、6〜8 月は夏、9〜11 月は秋、12〜2 月は冬 */
export function seasonOf(date: string): Season {
  const month = Number(date.slice(5, 7))
  if (month >= 3 && month <= 5) return 'spring'
  if (month >= 6 && month <= 8) return 'summer'
  if (month >= 9 && month <= 11) return 'autumn'
  return 'winter'
}

/** 「紅葉の2泊3日だね！」のように、季節を一言で言うときの言葉 */
export const SEASON_WORDS: Record<Season, string> = { spring: '桜', summer: '夏', autumn: '紅葉', winter: '雪' }
