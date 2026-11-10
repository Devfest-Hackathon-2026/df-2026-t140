import { useState } from 'react'
import { useMyAiAccess } from '@/entities/ai-access'
import { isLocal } from '@/shared/api'
import { type AppLockState, appLockState, LOCK_PARAM, LOCK_STORAGE_KEY } from './appLock'

/** 手元で ?lock を付けて開いたか。開いたときに 1 回だけ確かめ、タブを閉じるまで覚える */
function detectForced(): boolean {
  if (!isLocal) return false
  try {
    if (new URLSearchParams(location.search).has(LOCK_PARAM)) sessionStorage.setItem(LOCK_STORAGE_KEY, '1')
    return sessionStorage.getItem(LOCK_STORAGE_KEY) === '1'
  } catch {
    // sessionStorage を使えないブラウザでは、その URL のときだけ守る
    return new URLSearchParams(location.search).has(LOCK_PARAM)
  }
}

const forced = detectForced()

/** アプリ全体の合言葉の状態と、合言葉を通したあとに呼ぶもの */
export function useAppLock(): { state: AppLockState; open: () => void } {
  const access = useMyAiAccess()
  // 合言葉を通した直後は、記録が届くのを待たずに開く（記録の購読が切れていても進めるように）
  const [passed, setPassed] = useState(false)
  return {
    state: appLockState({
      local: isLocal,
      forced,
      loading: access.loading,
      unlocked: passed || access.data === true,
    }),
    open: () => setPassed(true),
  }
}
