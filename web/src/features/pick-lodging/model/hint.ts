// 検索欄の上の宿の知らせを、どの夜について出すかの決め（純粋。scripts/web.test.mjs で確かめる）

/** 端末に覚えた、知らせを閉じた夜（「1,2」の形） */
export function closedNights(saved: string | null): number[] {
  return (saved ?? '').split(',').map(Number).filter((night) => Number.isInteger(night) && night >= 1)
}

/**
 * 検索欄の上の、宿の知らせ（LodgingHint）を出す夜。宿がまだ決まっていない夜（openNights。早い順）のうち、
 * この端末で知らせを閉じていない、いちばん早い夜。なければ null
 */
export function hintNight(openNights: readonly number[], closed: readonly number[]): number | null {
  return openNights.find((night) => !closed.includes(night)) ?? null
}
