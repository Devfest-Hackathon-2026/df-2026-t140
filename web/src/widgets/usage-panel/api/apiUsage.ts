import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import type { ApiUsageRow } from '../model/usageRows'

/**
 * API の使用量を Functions に聞く（functions/src/features/api-usage）。
 * 本番では合言葉を通した人だけが読める。断られたときはエラーが投げられる
 */
export async function fetchApiUsage(session: Session): Promise<ApiUsageRow[]> {
  const result = await httpsCallable<void, { status: 'ok'; rows: ApiUsageRow[] }>(session.functions, 'getApiUsage')()
  return result.data.rows
}
