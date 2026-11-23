import type { ReactNode } from 'react'
import { useFirstRunTutorial } from '../model/useTutorialGate'
import { Tutorial } from './Tutorial'

/**
 * 初めて開いた端末では、中身（アプリの画面）より先にチュートリアルだけを出す。
 * 見終えるか飛ばすと、開こうとしていた画面をそのまま出す。2 回目からは、最初から中身を出す
 */
export function FirstRunTutorial({ children }: { children: ReactNode }) {
  const { show, done } = useFirstRunTutorial()
  if (show) return <Tutorial onClose={done} />
  return children
}
