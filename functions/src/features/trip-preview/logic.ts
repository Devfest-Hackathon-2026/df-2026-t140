/** 旅の名前の長さの上限（firestore.rules の validTripInfo と同じ） */
export const TRIP_TITLE_MAX = 40

/**
 * 旅のドキュメントから、参加前の人に見せてよい名前だけを取り出す。
 * 出発地や日程は見せない（出発地は家の近くのことがあるので、参加してから読む）。
 * 名前の形が崩れているときは null（画面は名前なしの見出しを出す）。
 */
export function previewTitle(data: unknown): string | null {
  const title = (data as { title?: unknown } | undefined)?.title
  if (typeof title !== 'string') return null
  const trimmed = title.trim()
  if (trimmed.length === 0 || trimmed.length > TRIP_TITLE_MAX) return null
  return trimmed
}
