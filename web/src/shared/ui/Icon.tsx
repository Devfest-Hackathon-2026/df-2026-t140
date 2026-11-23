import type { ReactNode } from 'react'

// 線だけの小さなアイコン。自分たちで描いたもので、外のアイコン集は使っていない。
const PATHS = {
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10v9.5h11V10" />
    </>
  ),
  // コレクション（建物のタイルが並ぶ画面）。四角が 4 つ
  collection: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  back: <path d="m14.5 5-7 7 7 7" />,
  // 戻す（取り消す）向きの矢印。左へ曲がって戻る
  undo: (
    <>
      <path d="M9 14 4.5 9.5 9 5" />
      <path d="M4.5 9.5h10a5 5 0 0 1 0 10H11" />
    </>
  ),
  chevron: <path d="m9.5 5 7 7-7 7" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.9.6 3.1 2.2 3.5 4.7" />
    </>
  ),
  map: (
    <>
      <path d="m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  // よくある共有のアイコン：角の丸い四角の上を空け、そこから上向きの矢印を出す
  share: (
    <>
      <path d="M12 14.5V3M8.5 6.5 12 3l3.5 3.5" />
      <path d="M9.5 9.5H8a2.5 2.5 0 0 0-2.5 2.5v6.5A2.5 2.5 0 0 0 8 21h8a2.5 2.5 0 0 0 2.5-2.5V12A2.5 2.5 0 0 0 16 9.5h-1.5" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM20 14v.5M14 20v-.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  'sound-high': (
    <>
      <rect x="1.8" y="9.7" width="2.7" height="4.6" rx=".4" />
      <path d="M6.5 9.4 12.5 4.5v15l-6-4.9z" />
      <path d="M15.3 8.6a5.1 5.1 0 0 1 0 6.8" />
      <path d="M17.8 6.4a8.5 8.5 0 0 1 0 11.2" />
    </>
  ),
  'sound-low': (
    <>
      <rect x="1.8" y="9.7" width="2.7" height="4.6" rx=".4" />
      <path d="M6.5 9.4 12.5 4.5v15l-6-4.9z" />
      <path d="M15.3 8.6a5.1 5.1 0 0 1 0 6.8" />
    </>
  ),
  'sound-off': (
    <>
      <rect x="1.8" y="9.7" width="2.7" height="4.6" rx=".4" />
      <path d="M6.5 9.4 12.5 4.5v15l-6-4.9z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  pencil: (
    <>
      <path d="m5 19 .8-3.8L15.5 5.5l3 3-9.7 9.7z" />
      <path d="m13.5 7.5 3 3" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  // 複製（しおりの行を、すぐ下にもう 1 つ入れる）。重なった 2 枚の紙
  copy: (
    <>
      <rect x="9" y="9" width="10.500" height="10.500" rx="2" />
      <path d="M15 5.500V5a1.500 1.500 0 0 0-1.500-1.500H5A1.500 1.500 0 0 0 3.500 5v8.500A1.500 1.500 0 0 0 5 15h.500" />
    </>
  ),
  play: <path d="M8 5.500v13l10.500-6.500z" />,
  pause: <path d="M9 5.500v13M15 5.500v13" />,
  // 早送り（旅の再生の速さ）
  fast: <path d="M4 6.500v11l7.500-5.500zM12.500 6.500v11L20 12z" />,
  // 歯車（旅の設定：メンバーと招待）
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      {/* 6 枚の歯を 60 度ごとに同じ形で回して置く（歯の先は中心から 8.5、付け根は 6.4）。どの向きでも円と外側の間が同じになる */}
      <path d="M9.92 5.95L10.31 3.67L13.69 3.67L14.08 5.95L16.2 7.17L18.37 6.37L20.06 9.3L18.28 10.78L18.28 13.22L20.06 14.7L18.37 17.63L16.2 16.83L14.08 18.05L13.69 20.33L10.31 20.33L9.92 18.05L7.8 16.83L5.63 17.63L3.94 14.7L5.72 13.22L5.72 10.78L3.94 9.3L5.63 6.37L7.8 7.17z" />
    </>
  ),
  // 2 つの点をつなぐ線（ルート）
  route: (
    <>
      <circle cx="6" cy="17.5" r="2.3" />
      <circle cx="18" cy="6.500" r="2.3" />
      <path d="M8 16c3-1 2.500-6 8-8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z" />
      <circle cx="12" cy="12" r="2.800" />
    </>
  ),
  // 建物（建てたものの数）
  house: (
    <>
      <path d="M4 11 12 4.500 20 11" />
      <path d="M6.500 9.500V19.500h11V9.500" />
    </>
  ),
  // 建てる（絵文字の 🔨 と同じ向き。頭が右上、柄が左下）
  hammer: (
    <g transform="rotate(45 12 12)">
      <rect x="5.500" y="4" width="13" height="5" rx="1.200" />
      <path d="M12 9v11" />
    </g>
  ),
  megaphone: (
    <>
      <path d="M4 10v4h3l6 4V6l-6 4z" />
      <path d="M16.500 9.500a3.500 3.500 0 0 1 0 5M19 7a7 7 0 0 1 0 10" />
    </>
  ),
  sparkle: <path d="M12 3.500 13.800 10.200 20.500 12l-6.700 1.800L12 20.500l-1.800-6.700L3.500 12l6.700-1.800z" />,
  // しおり
  bookmark: <path d="M7 4.500h10v15l-5-3.500-5 3.500z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.500V12l3 2" />
    </>
  ),
  // 外のアプリで開く（Google マップ）
  external: (
    <>
      <path d="M13.500 4.500h6v6M19.500 4.500 11 13" />
      <path d="M17 14v5.500H4.500V7H10" />
    </>
  ),
  // 出発地（集合場所）
  train: (
    <>
      <rect x="6" y="4" width="12" height="13" rx="3" />
      <path d="M6 11h12M9 20.500l1.500-3.500M15 20.500 13.500 17" />
      <circle cx="9.500" cy="14" r=".6" />
      <circle cx="14.500" cy="14" r=".6" />
    </>
  ),
  // 車（旅の移動手段）
  car: (
    <>
      <path d="M5 16.500V12l2-5h10l2 5v4.500z" />
      <path d="M5 12h14" />
      <circle cx="8.500" cy="16.500" r="1.800" />
      <circle cx="15.500" cy="16.500" r="1.800" />
    </>
  ),
  // 飛行機（しおりの区間の移動手段）
  plane: <path d="M21 12.500 13.500 10V5a1.500 1.500 0 0 0-3 0v5L3 12.500v2l7.500-1.500v4l-2.500 1.500V20l4-1 4 1v-1.500L13.500 17v-4L21 14.500z" />,
  // 徒歩（しおりの区間の移動手段）
  walk: (
    <>
      <circle cx="13" cy="4.500" r="1.800" />
      <path d="m9.500 21 2.500-6 2.500 2v4" />
      <path d="M12 15V9.500l-3.500 2.500v3M12 9.500l2.500 2.500 2.500.500" />
    </>
  ),
  up: <path d="m5 14.500 7-7 7 7" />,
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.500 10.500 4.500 4.500 4.500-4.500" />
      <path d="M5 19.500h14" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

interface Props {
  name: IconName
  size?: number
}

export function Icon({ name, size = 24 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
