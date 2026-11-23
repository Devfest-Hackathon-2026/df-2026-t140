import { type FormEvent, useState } from 'react'
import { addWish, type MapBounds, WISH_TEXT_MAX } from '@/entities/wish'
import { useSession } from '@/shared/api'
import { translate, playSound, prepareSounds } from '@/shared/lib'

/** 入力欄の上に出す、書き出しの例。押すと入力欄に入る */
export const WISH_EXAMPLES = [
  { label: translate('温泉', "Hot springs"), text: translate('温泉に入りたい', "I want to visit a hot spring") },
  { label: translate('ご当地グルメ', "Local food"), text: translate('ご当地グルメを食べたい', "I want to try local food") },
  { label: translate('夜景', "Night views"), text: translate('夜景を見たい', "I want to see the city at night") },
  { label: translate('自然', "Nature"), text: translate('自然の中を歩きたい', "I want to go for a walk in nature") },
] as const

/**
 * やりたいことを書く入力の状態と、書く操作（S04）。
 * getBounds は、いま地図で映している範囲を返す。希望と一緒に保存し、Functions がその範囲から場所を探す。
 * onAdded は、書けたときに希望の ID を渡して呼ぶ。
 */
export function useAddWish(tripId: string, getBounds: () => MapBounds | null, onAdded: (wishId: string) => void) {
  const session = useSession()
  const [text, setTextState] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const setText = (value: string) => {
    setTextState(value)
    setProblem(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    prepareSounds()
    const wish = text.trim()
    if (!wish) {
      playSound('attention')
      setProblem(translate('やりたいことを書いてください（例：温泉に入りたい）', 'Write what you want to do (e.g. visit a hot spring).'))
      return
    }
    if (wish.length > WISH_TEXT_MAX) {
      playSound('attention')
      setProblem(translate(`やりたいことは ${WISH_TEXT_MAX} 文字までです`, `Enter up to ${WISH_TEXT_MAX} characters.`))
      return
    }

    playSound('send')
    setSending(true)
    try {
      const wishId = await addWish(session, tripId, wish, getBounds())
      setTextState('')
      onAdded(wishId)
    } catch {
      playSound('error')
      setProblem(translate('書けませんでした。電波のよいところで、もう一度押してください。', "Couldn't send your request. Check your connection and try again."))
    } finally {
      setSending(false)
    }
  }

  return { text, setText, problem, sending, submit }
}
