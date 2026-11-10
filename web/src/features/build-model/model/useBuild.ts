import { useState } from 'react'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds } from '@/shared/lib'
import { requestBuild } from '../api/requestBuild'

/** Functions が断ったときのコード。この 4 つは、Functions が書いた理由の文をそのまま出す */
const REFUSED = [
  'functions/resource-exhausted',
  'functions/failed-precondition',
  'functions/permission-denied',
  'functions/not-found',
]

/**
 * 「建築する！」の操作。頼めたら onRequested を呼ぶ（待たずに、すぐ次のやりたいことを探せるようにする）。
 * 建築ができあがるのは待たない。
 */
export function useBuild(tripId: string, pinId: string, onRequested: () => void, retry = false) {
  const session = useSession()
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function build() {
    if (sending) return
    prepareSounds()
    if (!retry) playSound('build-press')
    setSending(true)
    setProblem(null)
    try {
      await requestBuild(session, tripId, pinId)
      onRequested()
    } catch (cause) {
      playSound('error')
      const { code, message } = cause as { code?: string; message?: string }
      setProblem(
        code && REFUSED.includes(code) && message
          ? message
          : '建築をはじめられませんでした。電波のよいところで、もう一度押してください。',
      )
    } finally {
      setSending(false)
    }
  }

  return { build, sending, problem }
}
