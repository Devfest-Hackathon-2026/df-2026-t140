import { useEffect, useState } from 'react'
import { useMyAiAccess } from '@/entities/ai-access'
import { isLocal, useSession } from '@/shared/api'
import { fetchApiUsage } from '../api/apiUsage'
import type { ApiUsageRow } from './usageRows'

/** スマホの画面（幅 480px）の横に、使用量の枠を置ける幅。UsagePanel.module.css の @media と同じ数にする */
export const WIDE_QUERY = '(min-width: 1024px)'

/** 読み直す間隔。開いたままでも、ほかの人の分の増え方が分かる */
const REFRESH_MS = 60_000

/** 画面の幅が広いか。幅が変わったら追いかける */
function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(WIDE_QUERY)
    if (!query) return
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

export type ApiUsageState = { status: 'hidden' } | { status: 'loading' } | { status: 'error' } | { status: 'ok'; rows: ApiUsageRow[] }

/**
 * API の使用量。PC の幅で、合言葉を通した人（手元では誰でも）のときだけ読む。
 * スマホの幅では Functions を呼ばない。タブが裏にある間は読み直さず、表に戻ったときに読む
 */
export function useApiUsage(): ApiUsageState {
  const session = useSession()
  const access = useMyAiAccess()
  const wide = useWide()
  const visible = wide && (isLocal || access.data === true)
  const [state, setState] = useState<ApiUsageState>({ status: 'loading' })

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const load = () => {
      if (document.visibilityState !== 'visible') return
      fetchApiUsage(session).then(
        (rows) => !cancelled && setState({ status: 'ok', rows }),
        () => !cancelled && setState({ status: 'error' }),
      )
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    document.addEventListener('visibilitychange', load)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
    }
  }, [visible, session])

  return visible ? state : { status: 'hidden' }
}
