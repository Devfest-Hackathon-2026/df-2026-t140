import { useEffect, useRef, useState } from 'react'
// ブラウザなしのテスト（scripts/web.test.mjs）で読めるよう、別名（@/）を使わずに読む
import { translate } from '../../../shared/lib/language.ts'

/** やりたいことの入力欄が空のときに、入れ替えて出す例文（Takana の依頼、2026-11-22） */
export const WISH_HINTS = [
  '金沢の文化を体験したい',
  '自然の中で遊びたい',
  'おいしいご当地グルメが食べたい',
  '美術館に行きたい',
  '温泉でのんびりしたい',
  'きれいな夜景を見たい',
  '広島風お好み焼きが食べたい',
  // 名所の名前だけでも書けることが伝わるように（Takana の依頼、2026-11-22）
  '美ら海水族館',
  '伏見稲荷神社',
  '厳島神社',
  '清水寺',
  '旭山動物園',
  '姫路城',
  '白川郷',
] as const

/** WISH_HINTS の英語版（同じ順・同じ数） */
export const WISH_HINTS_EN = [
  "I want to experience Kanazawa's culture",
  'I want to play in nature',
  'I want to try delicious local food',
  'I want to visit an art museum',
  'I want to relax in a hot spring',
  'I want to see a beautiful night view',
  'I want to eat Hiroshima-style okonomiyaki',
  'Churaumi Aquarium',
  'Fushimi Inari Shrine',
  'Itsukushima Shrine',
  'Kiyomizu-dera',
  'Asahiyama Zoo',
  'Himeji Castle',
  'Shirakawa-go',
] as const

/** 1 つの例文を出しておく時間 */
const SHOW_MS = 3000
/** 消える時間と、現れる時間（それぞれ。合わせて約 1 秒で入れ替わる）。WishBar.module.css の .hint の transition と合わせる */
const FADE_MS = 500

/** いまと違う例文の番号を、ランダムに選ぶ */
export function pickNextHint(current: number, count: number, random: () => number = Math.random): number {
  if (count < 2) return 0
  const next = Math.floor(random() * (count - 1))
  return next >= current ? next + 1 : next
}

/** いまの例文と違うものを、例文の組からランダムに選ぶ（組が替わったばかりでも、同じ文が続かないように） */
export function pickHint(hints: readonly string[], current: string | null, random: () => number = Math.random): string {
  if (hints.length === 0) return current ?? ''
  const at = hints.indexOf(current ?? '')
  if (at < 0) return hints[Math.floor(random() * hints.length)]
  return hints[pickNextHint(at, hints.length, random)]
}

/**
 * 入力欄の例文を、ランダムな順で入れ替える。shown が false のあいだに消え、次の例文に替わってから現れる。
 * active が false（欄に文字が入っている）のあいだは止めておく。
 * hints（見ている地域の例文。features/add-wish の hintsForArea）が替わっても間合いは変えず、次の入れ替えから新しい組で選ぶ
 */
export function useRotatingHint(active: boolean, hints: readonly string[] = translate<readonly string[]>(WISH_HINTS, WISH_HINTS_EN)): { hint: string; shown: boolean } {
  const [hint, setHint] = useState(() => pickHint(hints, null))
  const [shown, setShown] = useState(true)
  // 入れ替えの間合いを崩さないよう、組は効果の外で覚えておき、替えるときに読む
  const latest = useRef(hints)
  useEffect(() => {
    latest.current = hints
  }, [hints])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(
      () => {
        if (shown) {
          setShown(false)
          return
        }
        setHint((current) => pickHint(latest.current, current))
        setShown(true)
      },
      shown ? SHOW_MS : FADE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [active, shown])

  return { hint, shown }
}
