import type { SheetPhase } from '../lib/sheetPhase'
import styles from './sheetMotion.module.css'

// 動きの段階ごとのクラス。開いて止まった状態（rest）と、閉じた状態（peek。別の形で描く）は動かさない
const MOTION_CLASS: Record<SheetPhase, string> = {
  open: styles.open,
  switch: styles.switch,
  expand: styles.expand,
  closing: styles.closing,
  rest: '',
  peek: '',
}

/**
 * 下から出るシートの、動きの段階（shared/lib の useSheetMotion の phase）に合うクラス。
 * 開いた形のシートに付け、style で --peek-visible（閉じた状態で見えている高さ）を渡す
 */
export function sheetMotionClass(phase: SheetPhase): string {
  return MOTION_CLASS[phase]
}
