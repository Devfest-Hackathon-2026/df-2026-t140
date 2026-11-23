import type { ApiUsageRow } from '../../domain/apiUsage'

/**
 * ok：使用量を返す。
 * locked：合言葉を通していない（本番）。使用量は開発・運用のための表示なので、アプリを使える人にだけ見せる
 */
export type ApiUsageResult = { status: 'ok'; rows: ApiUsageRow[] } | { status: 'locked' }
