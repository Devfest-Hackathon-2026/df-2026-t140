import type { CSSProperties } from 'react'
import { SHEET_RETURN_MS } from '../lib/useSheetDrag'
import styles from './sheetDrag.module.css'

/** shared/lib の useSheetDrag が返す、見た目に要る値 */
interface DragView {
  offset: number | null
  returning: boolean
  launch: { dragFrom?: number; expandVisible?: number } | null
}

/** 取っ手に付けるクラス。指で触れる範囲を見た目より広げ、ブラウザのスクロールを止める */
export const sheetGripClass = styles.grip
/** 閉じた形のシート全体に付けるクラス（つかんで上へドラッグできる） */
export const sheetPeekGripClass = styles.peekGrip

/**
 * 開いた形のシートの style。--peek-visible（閉じた状態で見えている高さ）と、ドラッグ中は指について動く位置を渡す。
 * 指で引き上げて開いたときは、引き上げた高さから開く動きを始める。指で下げて閉じたときは、下げた位置から閉じる動きを始める
 */
export function sheetDragFullStyle(peekVisible: number, drag: DragView): CSSProperties {
  const style: Record<string, string> = {
    '--peek-visible': `${drag.launch?.expandVisible ?? peekVisible}px`,
  }
  if (drag.launch?.dragFrom !== undefined) style['--sheet-drag-from'] = `${drag.launch.dragFrom}px`
  if (drag.offset !== null) {
    style.transform = `translateY(${drag.offset}px)`
    // ドラッグ中は指についてくるだけ。足りずに戻るときだけ、戻る動きを付ける
    style.transition = drag.returning ? `transform ${SHEET_RETURN_MS}ms ease-out` : 'none'
    style.animation = 'none'
  }
  return style as CSSProperties
}

/** 閉じた形のシートの style。上へドラッグしている間は、指についてシートが伸びる */
export function sheetDragPeekStyle(peekVisible: number, drag: DragView): CSSProperties | undefined {
  if (drag.offset === null) return undefined
  return {
    minHeight: `${peekVisible - drag.offset}px`,
    transition: drag.returning ? `min-height ${SHEET_RETURN_MS}ms ease-out` : 'none',
  }
}
