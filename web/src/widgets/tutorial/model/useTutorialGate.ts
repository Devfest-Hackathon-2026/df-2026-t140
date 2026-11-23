import { useCallback, useState } from 'react'
import { recall, remember, simFrame } from '@/shared/lib'

/** この端末でチュートリアルを見終えた（または飛ばした）ことの覚え */
const SEEN_KEY = 'tutorial-seen'

/**
 * 初めて開いた端末かどうか。初めてなら show が true で、done を呼ぶと覚えて、次からは出さない。
 * 複数人シミュレーション（/dev/sim）の中の画面では出さない（台本が画面を操作するので、止まってしまう）
 */
export function useFirstRunTutorial() {
  const [show, setShow] = useState(() => simFrame === null && recall(SEEN_KEY) === null)
  const done = useCallback(() => {
    remember(SEEN_KEY, '1')
    setShow(false)
  }, [])
  return { show, done }
}

/** ホームのボタンから見返すときの、開いているかどうか */
export function useTutorialReplay() {
  const [open, setOpen] = useState(false)
  const show = useCallback(() => setOpen(true), [])
  const close = useCallback(() => {
    // 見返した人は、もう初めてではない（覚えを消した端末で、ボタンから先に見たときのため）
    remember(SEEN_KEY, '1')
    setOpen(false)
  }, [])
  return { open, show, close }
}
