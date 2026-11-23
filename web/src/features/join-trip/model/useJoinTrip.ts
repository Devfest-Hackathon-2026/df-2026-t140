import { type FormEvent, useState } from 'react'
import { memberNameProblem, recallMyName, rememberMyName } from '@/entities/member'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate as t } from '@/shared/lib'
import { joinTrip } from '../api/joinTrip'

/**
 * 招待された旅に参加する入力の状態と、参加の操作。
 * 参加できると、メンバーかどうかを見ている側（pages/trip-gate）が旅の画面に切り替える。
 */
export function useJoinTrip(tripId: string) {
  const session = useSession()
  const [name, setNameState] = useState(recallMyName)
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const setName = (value: string) => {
    setNameState(value)
    setProblem(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    prepareSounds()
    const found = memberNameProblem(name)
    setProblem(found)
    if (found) { playSound('attention'); return }

    setSending(true)
    try {
      await joinTrip(session, tripId, name)
      rememberMyName(name)
      playSound('confirm')
    } catch (cause) {
      playSound('error')
      // 旅がないと、ルールに拒否される（招待リンクが違うとき）
      const denied = (cause as { code?: string }).code === 'permission-denied'
      setProblem(
        denied
          ? t('この招待リンクの旅が見つかりません。リンクが途中で切れていないか、送ってくれた人に確かめてください。', 'Could not find the trip. Ask the sender to check the invite link.')
          : t('参加できませんでした。電波のよいところで、もう一度押してください。', 'Could not join the trip. Check your connection and try again.'),
      )
      setSending(false)
    }
  }

  return { name, setName, problem, sending, submit }
}
