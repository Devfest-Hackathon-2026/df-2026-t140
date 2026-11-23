import type { ReactNode } from 'react'
import type { PinCategory } from '../model/types'

// 場所の種類の絵。自分たちで描いた線だけの絵で、外のアイコン集は使っていない（shared/ui/Icon.tsx と同じ描き方）。
const PATHS: Record<PinCategory, ReactNode> = {
  // 湯気の立つ湯ぶね
  onsen: (
    <>
      <path d="M4.5 13.5h15c0 3.6-3 6-7.5 6s-7.5-2.4-7.5-6z" />
      <path d="M8.5 10c-1-1.4 1-2.2 0-3.6M12 10c-1-1.4 1-2.2 0-3.6M15.5 10c-1-1.4 1-2.2 0-3.6" />
    </>
  ),
  // 雪の山
  ski: (
    <>
      <path d="m3 19 6.5-12 3.5 6 2-3 6 9z" />
      <path d="m7.6 10.5 1.9 1.7 1.7-1.9" />
    </>
  ),
  // どんぶりと箸
  food: (
    <>
      <path d="M4 12h16c0 4-3.2 7-8 7s-8-3-8-7z" />
      <path d="m9 9 8-4.5M11.5 9.5 19 6" />
    </>
  ),
  // 葉
  farm: (
    <>
      <path d="M5 19c0-8 5-13.5 14-14 .5 9-5 14-11 14" />
      <path d="M5 19c2.5-4.5 6-7.5 10-9.5" />
    </>
  ),
  // 星
  nightview: <path d="m12 4 2.3 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.8 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  // 木
  nature: (
    <>
      <path d="M12 4 6.5 12h3L6 17h12l-3.5-5h3z" />
      <path d="M12 17v3.5" />
    </>
  ),
  // 鳥居
  shrine: (
    <>
      <path d="M3.5 7c5.6 1.4 11.4 1.4 17 0M5.5 11.5h13" />
      <path d="M8 8v12M16 8v12" />
    </>
  ),
  // 観覧車
  themepark: (
    <>
      <circle cx="12" cy="11" r="6.5" />
      <path d="M12 4.5v13M5.5 11h13M9 20.5l3-3.5 3 3.5" />
    </>
  ),
  // 店の並ぶ通り
  town: (
    <>
      <path d="M4.5 10.5 6 5.5h12l1.5 5c0 1.2-1 2-2.5 2s-2.5-.8-2.5-2c0 1.2-1 2-2.5 2s-2.5-.8-2.5-2c0 1.2-1 2-2.5 2s-2.5-.8-2.5-2z" />
      <path d="M6 13v6.5h12V13M10 19.5v-4h4v4" />
    </>
  ),
  // ベッド
  lodging: (
    <>
      <path d="M3.5 19V6.5M3.5 15.5h17V19M20.5 15.5v-2.5a3 3 0 0 0-3-3h-6v5.5" />
      <circle cx="7.3" cy="11.6" r="1.7" />
    </>
  ),
}

interface Props {
  category: PinCategory
  size?: number
}

export function CategoryIcon({ category, size = 24 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[category] ?? PATHS.town}
    </svg>
  )
}
