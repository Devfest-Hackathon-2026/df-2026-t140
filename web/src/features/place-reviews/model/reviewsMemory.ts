// 口コミの答えの覚え方と、画面に出す状態の決め方。React と Firebase に依存しない（node のテストから読む）
import type { PlaceReviews } from '../api/placeReviews'

export type ReviewsState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: PlaceReviews } | { status: 'none' }

/** 一度に覚えておく場所の数。古いものから捨てる */
export const MAX_REMEMBERED = 20

/**
 * 出せた口コミだけを覚える（場所 → 口コミ）。出せなかった答え（null）は覚えない。
 * 入れたら古いものから MAX_REMEMBERED を超えた分を捨てる
 */
export function remember(memory: Map<string, PlaceReviews>, key: string, data: PlaceReviews | null) {
  if (!data) return
  memory.delete(key)
  memory.set(key, data)
  while (memory.size > MAX_REMEMBERED) memory.delete(memory.keys().next().value as string)
}

/**
 * 画面に出す状態。覚えた口コミがあれば ready。なければ、今の場所の答えが届いていれば
 * その答え（出せなければ none）、届いていなければ loading
 */
export function reviewsState(
  memory: ReadonlyMap<string, PlaceReviews>,
  key: string,
  answer: { key: string; data: PlaceReviews | null } | null,
  active: boolean,
  askable: boolean,
): ReviewsState {
  if (!active || !askable) return { status: 'idle' }
  const data = memory.get(key) ?? (answer?.key === key ? answer.data : undefined)
  if (data) return { status: 'ready', data }
  return answer?.key === key ? { status: 'none' } : { status: 'loading' }
}
