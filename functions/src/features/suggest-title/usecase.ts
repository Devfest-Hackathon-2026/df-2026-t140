import { decideAiGate } from '../../domain/geminiBudget'
import type { GeminiPermit } from '../../ports/gemini'
import type { SuggestTitlePorts } from './ports'
import { suggestTitleTask } from './prompt'
import type { SuggestTitleInput } from './types'

/**
 * 旅の名前を考える。費用のかかる経路（vertex）では、頼んだ人が合言葉を通しているか全員に開く切り替えが入っていて、
 * Flash の累計の上限の中のときだけ本物を呼ぶ。通らなければ固定の応答（季節と行き先から作る名前）を返す（design-principles の cost/gemini-guarded）
 */
export async function suggestTitle(
  ports: SuggestTitlePorts,
  input: SuggestTitleInput,
  uid: string,
  options: { guarded: boolean } = { guarded: false },
): Promise<{ title: string; provider: string; fellBack: boolean }> {
  const permit = options.guarded ? await titlePermit(ports, uid) : undefined
  const result = await ports.gemini.run(suggestTitleTask, input, { permit })
  return { title: result.output.title, provider: result.provider, fellBack: result.fellBack }
}

/** 関所を通す（テストのために export する）。合言葉を通していなければ回数を数えない */
export async function titlePermit(ports: Pick<SuggestTitlePorts, 'aiGate'>, uid: string): Promise<GeminiPermit | undefined> {
  const unlocked = (await ports.aiGate.isOpenToAll()) || (await ports.aiGate.isUnlocked(uid))
  const reserved = unlocked ? await ports.aiGate.reserveFlashCall() : false
  const decision = decideAiGate({ unlocked, reserved })
  if (decision !== 'ok') {
    console.info(`旅の名前：本物の Gemini は使わず固定の応答にします（${decision}）`)
    return undefined
  }
  return { uid, refund: () => ports.aiGate.refundFlashCall() }
}
