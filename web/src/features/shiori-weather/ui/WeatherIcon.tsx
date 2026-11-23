import type { ReactNode } from 'react'
import { translate } from '@/shared/lib'
import type { Sky } from '../api/shioriWeather'

// しおりの行の右端に出す、天気の小さな絵。自分たちで描いたもので、外のアイコン集は使っていない。
// 晴れは笑った太陽、くもりは笑った雲、雨は傘としずく、雪は雪だるまと雪の結晶（Takana の依頼、2026-11-22）。
// 色は天気ごとに決まっているので、明るい画面でも暗い画面でも同じ色にする（線を濃いめにして、どちらの地でも見えるようにした）
const LABELS: Record<Sky, string> = translate<Record<Sky, string>>(
  { sunny: '晴れ', cloudy: 'くもり', rain: '雨', snow: '雪' },
  { sunny: 'Sunny', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow' },
)

const FACE = '#5b4636'

const DRAWINGS: Record<Sky, ReactNode> = {
  sunny: (
    <>
      <g stroke="#f5a524" strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 2.5v3M16 26.5v3M2.5 16h3M26.5 16h3M6.5 6.5l2.1 2.1M23.4 23.4l2.1 2.1M6.5 25.5l2.1-2.1M23.4 8.6l2.1-2.1" />
      </g>
      <circle cx="16" cy="16" r="8.4" fill="#ffcf40" stroke="#f0a21c" strokeWidth="1.3" />
      <circle cx="13.2" cy="15" r="1.05" fill={FACE} />
      <circle cx="18.8" cy="15" r="1.05" fill={FACE} />
      <circle cx="11.4" cy="17.9" r="1.35" fill="#ff9aa2" opacity="0.85" />
      <circle cx="20.6" cy="17.9" r="1.35" fill="#ff9aa2" opacity="0.85" />
      <path d="M13.6 18.2q2.4 2.2 4.8 0" fill="none" stroke={FACE} strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  cloudy: (
    <>
      <path
        d="M9 25h14.5a5.5 5.5 0 0 0 .9-10.9A7.5 7.5 0 0 0 10 13.1 6 6 0 0 0 9 25z"
        fill="#eef2f8"
        stroke="#8a9bb5"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="18.6" r="1" fill={FACE} />
      <circle cx="19.4" cy="18.6" r="1" fill={FACE} />
      <circle cx="12.3" cy="21.1" r="1.25" fill="#ffb3ba" opacity="0.8" />
      <circle cx="21.1" cy="21.1" r="1.25" fill="#ffb3ba" opacity="0.8" />
      <path d="M15.1 21.1q1.6 1.4 3.2 0" fill="none" stroke={FACE} strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  rain: (
    <>
      <path d="M16 5.2V3.4" stroke="#2f78b7" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M4.5 16.5a11.5 11.5 0 0 1 23 0c-1.9-1.7-4.1-1.7-5.75 0-1.65-1.7-4.1-1.7-5.75 0-1.65-1.7-4.1-1.7-5.75 0-1.65-1.7-3.85-1.7-5.75 0z"
        fill="#5aaee6"
        stroke="#2f78b7"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M16 5.2c-2.6 2.8-3.3 7-2.9 11.3h5.8c.4-4.3-.3-8.5-2.9-11.3z" fill="#9fd3f5" />
      <path d="M16 16.5v8.5a2.4 2.4 0 0 1-4.8 0" fill="none" stroke="#7a5230" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M24.5 21c1 1.4 1.6 2.3 1.6 3a1.6 1.6 0 0 1-3.2 0c0-.7.6-1.6 1.6-3z" fill="#5aaee6" />
      <path d="M6.5 22.5c.9 1.2 1.4 2 1.4 2.6a1.4 1.4 0 0 1-2.8 0c0-.6.5-1.4 1.4-2.6z" fill="#5aaee6" />
    </>
  ),
  snow: (
    <>
      <path d="M25 3v8.6M21.3 5.15l7.4 4.3M21.3 9.45l7.4-4.3" stroke="#5aaee6" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13.5" cy="23" r="6.6" fill="#ffffff" stroke="#93a8c2" strokeWidth="1.3" />
      <circle cx="13.5" cy="12.6" r="4.8" fill="#ffffff" stroke="#93a8c2" strokeWidth="1.3" />
      <circle cx="11.9" cy="12" r="0.85" fill={FACE} />
      <circle cx="15.1" cy="12" r="0.85" fill={FACE} />
      <path d="M13.5 13.4l2.9.8-2.9.7z" fill="#f28c28" />
      <path d="M9.4 17h8.2" stroke="#e5576a" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M16 17.2v3" stroke="#e5576a" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="13.5" cy="21.6" r="0.85" fill={FACE} />
      <circle cx="13.5" cy="24.6" r="0.85" fill={FACE} />
    </>
  ),
}

export function WeatherIcon({ sky, size = 28, className }: { sky: Sky; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={LABELS[sky]}>
      <title>{LABELS[sky]}</title>
      {DRAWINGS[sky]}
    </svg>
  )
}
