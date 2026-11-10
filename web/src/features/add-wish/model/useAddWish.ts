import { type FormEvent, useState } from 'react'
import { addWish, type MapBounds, WISH_TEXT_MAX } from '@/entities/wish'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds } from '@/shared/lib'

/** 入力欄の上に出す、書き出しの例。押すと入力欄に入る */
export const WISH_EXAMPLES = [
  { label: '温泉', text: '温泉に入りたい' },
  { label: 'ご当地グルメ', text: 'ご当地グルメを食べたい' },
  { label: '夜景', text: '夜景を見たい' },
  { label: '自然', text: '自然の中を歩きたい' },
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
      setProblem('やりたいことを書いてください（例：温泉に入りたい）')
      return
    }
    if (wish.length > WISH_TEXT_MAX) {
      playSound('attention')
      setProblem(`やりたいことは ${WISH_TEXT_MAX} 文字までです`)
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
      setProblem('書けませんでした。電波のよいところで、もう一度押してください。')
    } finally {
      setSending(false)
    }
  }

  return { text, setText, problem, sending, submit }
}
