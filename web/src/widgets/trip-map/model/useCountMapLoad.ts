import { useCallback } from 'react'
import { useSession } from '@/shared/api'
import { countMapLoad } from '../api/countMapLoad'

/** 地図を 1 つ作ったときに呼ぶもの。API の使用量の表示（widgets/usage-panel）のために、地図の読み込みを数える */
export function useCountMapLoad(): () => void {
  const session = useSession()
  return useCallback(() => countMapLoad(session), [session])
}
