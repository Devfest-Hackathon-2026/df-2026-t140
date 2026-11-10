import { type FormEvent, useState } from 'react'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds } from '@/shared/lib'
import { unlockAi } from '../api/unlockAi'

/** 合言葉の長さの上限。Functions 側（features/unlock-ai/logic.ts）と合わせる */
export const PASSPHRASE_MAX = 64

/** 合言葉の入力の状態と、送る操作。通ったら onDone を呼ぶ */
export function useUnlockAi(onDone: () => void) {
  const session = useSession()
  const [passphrase, setPassphrase] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    prepareSounds()
    const value = passphrase.trim()
    if (value.length === 0) {
      playSound('attention')
      setProblem('合言葉を入れてください。')
      return
    }
    setSending(true)
    setProblem(null)
    try {
      await unlockAi(session, value)
      playSound('unlock')
      setPassphrase('')
      onDone()
    } catch (cause) {
      playSound('error')
      // Firebase の SDK は、理由の文の後ろに「 [403]」のような状態番号を足すので、画面に出す前に外す
      const reason = cause instanceof Error ? cause.message.replace(/\s*\[\d{3}\]$/, '') : ''
      setProblem(reason || '送れませんでした。もう一度押してください。')
    } finally {
      setSending(false)
    }
  }

  return { passphrase, setPassphrase, problem, sending, submit }
}
