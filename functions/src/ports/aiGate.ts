// 費用のかかる Gemini（Cloud の vertex）を呼ぶ前の関所の型（ポート）。実体は adapters/aiGate.ts。
// 判断の決まり（上限の数、通す条件）は domain/geminiBudget.ts。ここは Firestore に聞くことの型だけ。

export interface AiGatePort {
  /**
   * 全員に本物を開く切り替えが入っているか（settings/ai の openToAll が true か）。
   * 入っていれば合言葉の確かめを飛ばす。回数の上限は reserve〜Call がそのまま見る
   */
  isOpenToAll(): Promise<boolean>
  /** その人が合言葉を通しているか（aiAccess/{uid} があるか） */
  isUnlocked(uid: string): Promise<boolean>
  /**
   * Flash の累計の上限の中なら、1 回分を数えて true。上限に達していれば、数えずに false。
   * 同時に 2 つの関数が呼んでも数が飛ばないよう、実体はトランザクションで数える
   */
  reserveFlashCall(): Promise<boolean>
  /**
   * 数えた 1 回を戻す。Vertex が設定の誤り（401、403、404）で失敗したときだけ使う（domain/geminiBudget.ts）。
   * 0 より下にはしない
   */
  refundFlashCall(): Promise<void>
  /**
   * Argon（模型）の 1 日の上限と累計の上限の中なら、1 回分を数えて true。どちらかに達していれば、数えずに false。
   * Flash と同じく、実体はトランザクションで数える（usage/argon）
   */
  reserveArgonCall(): Promise<boolean>
  /** 数えた Argon の 1 回を戻す。使う場面は refundFlashCall と同じ */
  refundArgonCall(): Promise<void>
}
