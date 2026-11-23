// 旅をつくる画面の乗り物の絵。「なにで行く？」の選び札に使う

/** 電車の絵（横幅 width px） */
export function TrainArt({ width }: { width: number }) {
  return (
    <svg width={width} height={Math.round((width * 64) / 120)} viewBox="0 0 120 64" aria-hidden="true">
      <path d="M6 52V22a14 14 0 0114-14h68c12 0 20 6 25 17l5 13v14z" fill="var(--color-route)" />
      <rect x="6" y="36" width="112" height="6" fill="#fff" />
      <rect x="18" y="15" width="14" height="13" rx="3" fill="#dff1ff" />
      <rect x="38" y="15" width="14" height="13" rx="3" fill="#dff1ff" />
      <rect x="58" y="15" width="14" height="13" rx="3" fill="#dff1ff" />
      <path d="M84 15h6c8 0 13 4 16 13H84z" fill="#dff1ff" />
      <circle cx="28" cy="54" r="8" fill="var(--color-text)" />
      <circle cx="92" cy="54" r="8" fill="var(--color-text)" />
    </svg>
  )
}

/** 車の絵（横幅 width px） */
export function CarArt({ width }: { width: number }) {
  return (
    <svg width={width} height={Math.round((width * 60) / 100)} viewBox="0 0 100 60" aria-hidden="true">
      <path d="M8 44V32l10-4 12-16h34l16 16 12 3v13z" fill="var(--color-route)" />
      <path d="M33 16h13v14H22zM50 16h12l13 14H50z" fill="#dff1ff" />
      <rect x="84" y="33" width="8" height="5" rx="2" fill="#ffd34d" />
      <circle cx="27" cy="46" r="9" fill="var(--color-text)" />
      <circle cx="74" cy="46" r="9" fill="var(--color-text)" />
    </svg>
  )
}
