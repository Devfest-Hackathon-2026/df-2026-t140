import { type ReactNode, useState } from 'react'
import { useSwipeHint } from '../lib/swipeHint'
import { Icon } from './Icon'
import styles from './SideCards.module.css'

interface Props {
  /** 前・次の場所の名前（読み上げ用）と、移る処理。端なら渡さない（その側にはのぞかせない） */
  prev?: { name: string; go: () => void }
  next?: { name: string; go: () => void }
  /** のぞくカードを、カードの後ろから左右へ出てくる動きで出す（しおりから場所の情報を開いたときなど） */
  appear?: boolean
  /** のぞくカードを一時だけ隠す（シートを指で動かしている間や、閉じる途中） */
  hideSides?: boolean
  /** はじめての時の一言と揺れを出してよいか（カードを開いたときだけ。前後へ移ったときは出さない） */
  hintable?: boolean
  /** 真ん中のカード（場所カード、場所の情報のシート） */
  children: ReactNode
}

/**
 * 場所カード（S05）と場所の情報（S12）に共通の、左右にスワイプできると分かる見せ方。
 * 前・次があるとき、カードを左右に少し細くし、空いたところに、となりのカードの端をのぞかせる。押すとその場所へ移る。
 * はじめての時だけ、カードが左へ少し揺れて「左右にスワイプすると、ほかの場所に切り替わります」と数秒出す
 * （ヨウキンが 2026-11-07 に Claude Design の案 3 から選んだ。一度でも移ったら、その端末ではもう出さない）
 */
export function SideCards({ prev, next, appear = false, hideSides = false, hintable = false, children }: Props) {
  const sided = Boolean(prev || next)
  // 出てくる動きは、appear が true になった時点で始め、のぞくカードの動きが終わるまで続ける
  // （シートの動きは先に終わり、appear はすぐ false に戻るため、そのまま使うと途中で切れる）
  const [appearing, setAppearing] = useState(appear)
  const [lastAppear, setLastAppear] = useState(appear)
  if (appear !== lastAppear) {
    setLastAppear(appear)
    if (appear) setAppearing(true)
  }
  const endAppear = () => setAppearing(false)
  // 一言と揺れは、のぞくカードを出している間だけ（閉じた状態や、指で動かしている間は出さない）
  const hint = useSwipeHint(sided && hintable) && sided && !hideSides
  const wrapClass = [styles.wrap, sided && styles.withSides, sided && appearing && styles.appear, hideSides && styles.sidesHidden].filter(Boolean).join(' ')
  return (
    <div className={wrapClass}>
      {hint && (
        <p className={styles.hint} role="status">
          左右にスワイプすると、ほかの場所に切り替わります
        </p>
      )}
      {/* カードの左右の端から、となりのカードが少しのぞく。押すと、スワイプと同じように移る（端の側には出さない） */}
      {prev && (
        <button type="button" className={`${styles.side} ${styles.sidePrev}`} aria-label={`前の場所：${prev.name}`} onClick={prev.go} onAnimationEnd={endAppear}>
          <Icon name="back" size={16} />
        </button>
      )}
      {next && (
        <button type="button" className={`${styles.side} ${styles.sideNext}`} aria-label={`次の場所：${next.name}`} onClick={next.go} onAnimationEnd={endAppear}>
          <Icon name="chevron" size={16} />
        </button>
      )}
      <div className={`${styles.body} ${hint ? styles.nudge : ''}`}>{children}</div>
    </div>
  )
}
