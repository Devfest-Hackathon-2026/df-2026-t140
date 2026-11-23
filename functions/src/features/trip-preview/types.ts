/**
 * 招待の画面に出す、旅の名前だけの結果。
 * not-found：その ID の旅がない（招待リンクが途中で切れているときなど）。
 */
export type TripPreviewResult = { status: 'ok'; title: string | null } | 'not-found'
