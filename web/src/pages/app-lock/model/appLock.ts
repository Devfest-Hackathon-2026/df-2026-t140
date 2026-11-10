// アプリ全体を合言葉で守るかどうかの判断（かめの決定、todo/humans/2026-11-10-app-passphrase-gate.md）。
// 本番の URL では、合言葉を通した記録（aiAccess/{uid}）がある端末だけに画面を出す。
// 手元（Emulator）では守らない。開発、複数人シミュレーション、確認テストを今までどおり動かすため。
// 手元でも、URL に ?lock を付けて開いたタブでは守る（合言葉の画面を確かめる用）。

/** 手元で合言葉の画面を確かめるときに、URL に付ける印（?lock） */
export const LOCK_PARAM = 'lock'

/** ?lock で開いたことを、そのタブを閉じるまで覚える置き場（画面を移っても守り続ける） */
export const LOCK_STORAGE_KEY = 'konbu:app-lock'

export type AppLockState = 'open' | 'checking' | 'locked'

export interface AppLockInput {
  /** Emulator につないでいるか */
  local: boolean
  /** 手元で ?lock を付けて開いたか */
  forced: boolean
  /** 合言葉の記録を読んでいる途中か */
  loading: boolean
  /** 合言葉の記録があるか。読めなかったときは false */
  unlocked: boolean
}

/** 画面を出すか（open）、記録を待つか（checking）、合言葉の画面を出すか（locked） */
export function appLockState({ local, forced, loading, unlocked }: AppLockInput): AppLockState {
  if (local && !forced) return 'open'
  if (unlocked) return 'open'
  return loading ? 'checking' : 'locked'
}
