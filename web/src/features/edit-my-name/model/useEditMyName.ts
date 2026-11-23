import { type FormEvent, useState } from 'react'
import { memberNameProblem, rememberMyName, updateMyProfile } from '@/entities/member'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate as t } from '@/shared/lib'

/** この旅での自分の表示名を直す入力の状態と、保存の操作。保存できたら onDone を呼ぶ */
export function useEditMyName(tripId: string, currentName: string, onDone: () => void) {
  const session = useSession()
  const [name, setName] = useState(currentName)
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    prepareSounds()
    const found = memberNameProblem(name)
    setProblem(found)
    if (found) { playSound('attention'); return }
    try {
      await updateMyProfile(session, tripId, { displayName: name })
      rememberMyName(name)
      playSound('confirm')
      onDone()
    } catch {
      playSound('error')
      setProblem(t('名前を変えられませんでした。もう一度押してください。', 'Could not change your name. Try again.'))
    }
  }

  return { name, setName, problem, submit }
}
