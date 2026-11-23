import { API_USAGE_DOC, apiUsageDay, apiUsageRows, COUNTED_APIS, type ApiUsageRecord, type CountedApi } from '../../domain/apiUsage'
import { budgetDay, USAGE_ARGON_DOC, USAGE_COLLECTION, USAGE_FLASH_DOC } from '../../domain/geminiBudget'
import { canSeeUsage } from './logic'
import type { ApiUsagePorts } from './ports'
import type { ApiUsageResult } from './types'

/**
 * API の使用量を読む。読む → logic で決める → 形を整える。書かない。
 * Gemini は止めるための数（usage/flash、usage/argon）を、Maps 系は表示のための数（usage/<API>、adapters/apiUsage.ts）を読む
 */
export async function getApiUsage(
  ports: ApiUsagePorts,
  input: { uid: string; local: boolean; photosEnabled: boolean; now: Date },
): Promise<ApiUsageResult> {
  const unlocked = input.local || (await ports.aiGate.isUnlocked(input.uid))
  if (!canSeeUsage({ local: input.local, unlocked })) return { status: 'locked' }

  const usage = ports.db.collection(USAGE_COLLECTION)
  const [flash, argon, ...apiSnapshots] = await ports.db.getAll(
    usage.doc(USAGE_FLASH_DOC),
    usage.doc(USAGE_ARGON_DOC),
    ...COUNTED_APIS.map((api) => usage.doc(API_USAGE_DOC[api])),
  )
  const apis: Partial<Record<CountedApi, ApiUsageRecord>> = {}
  COUNTED_APIS.forEach((api, index) => {
    apis[api] = apiSnapshots[index]?.data()
  })
  return {
    status: 'ok',
    rows: apiUsageRows({
      flash: flash.data(),
      argon: argon.data(),
      apis,
      argonToday: budgetDay(input.now),
      apiToday: apiUsageDay(input.now),
      photosEnabled: input.photosEnabled,
    }),
  }
}
