import { REGION_IDS, REGION_NAMES, REGION_PREFECTURES } from '@/entities/trip'
import { PREFECTURE_HINTS } from './prefectureHints'
import { appLanguage } from '@/shared/lib'
import { WISH_HINTS, WISH_HINTS_EN } from './useRotatingHint'

/** 地方の名前（「東北」）→ その地方の県の例文を合わせたもの */
const REGION_HINTS: Record<string, readonly string[]> = Object.fromEntries(
  REGION_IDS.map((id) => [REGION_NAMES[id], REGION_PREFECTURES[id].flatMap((prefecture) => PREFECTURE_HINTS[prefecture] ?? [])]),
)

/**
 * いま見ている地域（都道府県の名前か、地方の名前。日本全体なら null。widgets/trip-map の focusAreaName）に合う例文。
 * 県ならその県の 4 つ、地方ならその地方の県の例文を合わせたもの、日本全体や知らない名前なら全国向けの例文。
 * 英語のときは、地域ごとの例文がまだないので、どこを見ていても全国向けの英語の例文を出す
 */
export function hintsForArea(area: string | null): readonly string[] {
  if (appLanguage === 'en') return WISH_HINTS_EN
  if (!area) return WISH_HINTS
  return PREFECTURE_HINTS[area] ?? REGION_HINTS[area] ?? WISH_HINTS
}
