import { type FormEvent, useState } from 'react'
import { joinCodeProblem, normalizeJoinCode } from '@/entities/trip'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate as t } from '@/shared/lib'
import { findTripByJoinCode } from '../api/findTrip'

/**
 * 旅の合言葉の入力の状態と、その旅を探す操作。
 * 見つかったら、旅の ID を渡して onFound を呼ぶ（呼ぶ側が旅の画面を開く）。
 */
export function useJoinByCode(onFound: (tripId: string) => void) {
  const session = useSession()
  const [code, setCodeState] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const setCode = (value: string) => {
    setCodeState(value)
    setProblem(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    prepareSounds()
    const found = joinCodeProblem(code)
    setProblem(found)
    const joinCode = normalizeJoinCode(code)
    if (found || !joinCode) { playSound('attention'); return }

    setSending(true)
    try {
      const tripId = await findTripByJoinCode(session, joinCode)
      playSound('confirm')
      onFound(tripId)
    } catch (cause) {
      playSound('error')
      const reason = (cause as { code?: string }).code
      setProblem(
        reason === 'functions/not-found'
          ? t('この合言葉の旅が見つかりません。合言葉を教えてくれた人に確かめてください。', 'No trip matches this code. Check it with the person who invited you.')
          : reason === 'functions/resource-exhausted'
            ? t('合言葉を何度も間違えたので、しばらく使えません。1 時間ほどたってから試すか、招待リンクから入ってください。', 'Too many incorrect attempts. Try again in about an hour or use your invite link.')
            : t('旅を探せませんでした。電波のよいところで、もう一度押してください。', 'Could not look up the trip. Check your connection and try again.'),
      )
      setSending(false)
    }
  }

  return { code, setCode, problem, sending, submit }
}
