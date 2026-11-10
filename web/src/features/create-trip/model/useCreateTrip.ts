import { type FormEvent, useState } from 'react'
import { memberNameProblem, recallMyName, rememberMyName } from '@/entities/member'
import { type TripInfo, tripInfoProblem } from '@/entities/trip'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, today } from '@/shared/lib'
import { createTrip } from '../api/createTrip'

/**
 * 旅をつくる入力の状態と、作る操作。
 * onCreated は、作れたときに旅の ID を渡して呼ぶ。
 */
export function useCreateTrip(onCreated: (tripId: string) => void) {
  const session = useSession()
  const [info, setInfoState] = useState<TripInfo>({ title: '', startDate: today(), endDate: null, origin: '' })
  const [name, setNameState] = useState(recallMyName)
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // 入力を直したら、前の注意は消す
  const setInfo = (value: TripInfo) => {
    setInfoState(value)
    setProblem(null)
  }
  const setName = (value: string) => {
    setNameState(value)
    setProblem(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    prepareSounds()
    const found = tripInfoProblem(info) ?? memberNameProblem(name)
    setProblem(found)
    if (found) { playSound('attention'); return }

    setSending(true)
    try {
      const tripId = await createTrip(session, info, name)
      rememberMyName(name)
      onCreated(tripId)
    } catch {
      playSound('error')
      setProblem('旅を作れませんでした。電波のよいところで、もう一度押してください。')
      setSending(false)
    }
  }

  return { info, setInfo, name, setName, problem, sending, submit }
}
