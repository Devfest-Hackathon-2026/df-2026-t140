import { useState } from 'react'
import { BUILD_LIMIT_PER_TRIP } from '@/entities/pin'
import { useSession } from '@/shared/api'
import { translate, playSound, prepareSounds } from '@/shared/lib'
import { requestBuild } from '../api/requestBuild'

function buildRefusal(code?: string, message?: string): string | undefined {
  if (!message) return
  if (code === 'functions/resource-exhausted') return translate(message, `This trip is limited to ${BUILD_LIMIT_PER_TRIP} buildings.`)
  if (code === 'functions/permission-denied') return translate(message, "You're not a member of this trip.")
  if (code === 'functions/not-found') return translate(message, 'This pin is no longer available.')
  if (code === 'functions/failed-precondition') {
    return translate(message, message === '旅程が確定しているので、建てられません'
      ? "You can't build while the itinerary is finalized."
      : 'Building has already started for this place.')
  }
}

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
        buildRefusal(code, message)
          ?? translate('建築をはじめられませんでした。電波のよいところで、もう一度押してください。', "Couldn't start building. Check your connection and try again."),
      )
    } finally {
      setSending(false)
    }
  }

  return { build, sending, problem }
}
