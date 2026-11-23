import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { translate } from '@/shared/lib'
import { useSkipKey } from '../model/useSkipKey'
import styles from './ShioriGuide.module.css'

interface Props {
  /** 明るく残した再生ボタンを押した（旅の再生を始める） */
  onPlay: () => void
  /** 暗い所を押した（か Esc キー）。案内をそこで終える（確定ボタンや再生ボタンの案内へは進まない） */
  onSkip: () => void
  /** シートか再生ボタンが見つからなかった（案内を出せない。後ろの画面を inert のままにしないよう、案内を終える） */
  onMissing: () => void
}

/**
 * 案内の段。sheet：シートだけ明るい。cover：暗い面が下へ流れてシートも暗くなる。
 * scroll：シートを明るく残したまま、一覧を一番下まで送る。confirm：確定ボタン（「この旅で決まり！」）のまわりだけ明るい。
 * play：再生ボタンのまわりだけ明るい
 */
type Phase = 'sheet' | 'cover' | 'scroll' | 'confirm' | 'play'

/** 暗い面が下へ流れきるまでの時間（ShioriGuide.module.css の .sheetHole の transition と合わせる） */
const COVER_MS = 520
/** 一覧を一番下まで送る動きを待つ上限（scrollend が届かないブラウザでも、ここで次へ進む） */
const SCROLL_MAX_MS = 1100
/** 再生ボタンの外へ、明るく残す丸がはみ出す分（px） */
const HOLE_PAD = 10
/** 確定ボタンの外へ、明るく残す枠がはみ出す分（px） */
const CONFIRM_PAD = 8

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const sheetElement = () => document.querySelector<HTMLElement>('[data-guide="shiori-sheet"]')
const confirmElement = () => document.querySelector<HTMLElement>('[data-guide="shiori-confirm"]')

const boxOf = (element: Element | null | undefined): Box | null => {
  if (!element) return null
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

/**
 * しおりの中の案内（S07）。場所の入ったしおりの画面を初めて開いたときに、旅ごとに一度だけ出す（useShioriGuide）。
 * 1. 画面を暗くして下のシートだけ明るく残し、シートへの矢印と文字を出す。明るく残したシートを押すと、後ろの画面は動かさずに次へ進む
 * 2. 確定ボタンがあれば（発案者で、まだ確定していない）、一覧を一番下まで自動で送り、確定ボタンのまわりだけ明るくして
 *    「旅に満足したら確定しよう！」と出す。明るく残したボタンを押しても確定はせず、次へ進む（Takana の依頼、2026-11-22）。
 *    確定ボタンがなければ、暗い面が下へ流れてシートも暗くなる
 * 3. 文字が消えると同時に、左の再生ボタンのまわりが明るくなって、そこへの矢印と文字を出す
 * 4. 再生ボタン（明るく残した丸）を押すと、旅の再生が始まって消える
 * どの段でも、暗い所を押すか Esc キーで、そこで案内を終える（とばす）。後ろの画面は inert にする
 * シートと再生ボタンは ShioriSheet が、確定ボタンは ConfirmShioriButton が付けた印（data-guide）で探して測る。
 */
export function ShioriGuide({ onPlay, onSkip, onMissing }: Props) {
  const [phase, setPhase] = useState<Phase>('sheet')
  const [sheet, setSheet] = useState<Box | null>(null)
  const [radius, setRadius] = useState(0)
  const [play, setPlay] = useState<Box | null>(null)
  const [confirm, setConfirm] = useState<Box | null>(null)
  const [confirmRadius, setConfirmRadius] = useState(0)
  const [viewHeight, setViewHeight] = useState(() => window.innerHeight)
  const next = useRef<HTMLButtonElement>(null)
  const hole = useRef<HTMLButtonElement>(null)
  const confirmHole = useRef<HTMLButtonElement>(null)
  const sheetTextId = useId()
  const confirmTextId = useId()
  const playTextId = useId()

  // シートと確定ボタンと再生ボタンの位置を測る
  const measure = useCallback(() => {
    const found = sheetElement()
    setSheet(boxOf(found))
    setRadius(found ? parseFloat(getComputedStyle(found).borderTopLeftRadius) || 0 : 0)
    setPlay(boxOf(document.querySelector('[data-guide="shiori-play"]')))
    const confirmButton = confirmElement()
    setConfirm(boxOf(confirmButton))
    setConfirmRadius(confirmButton ? parseFloat(getComputedStyle(confirmButton).borderTopLeftRadius) || 0 : 0)
    setViewHeight(window.innerHeight)
  }, [])

  // 画面の大きさやシートの高さが変わったら測り直す
  useLayoutEffect(() => {
    measure()
    const found = sheetElement()
    if (!found || !document.querySelector('[data-guide="shiori-play"]')) {
      onMissing()
      return
    }
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(found)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [onMissing, measure])

  // シートを押したら：確定ボタンがあれば一覧を一番下まで送る。なければ暗い面を下へ流す
  const fromSheet = () => setPhase(confirmElement() ? 'scroll' : 'cover')

  // 一覧を一番下まで送り、止まったら確定ボタンを測って、その案内へ
  useEffect(() => {
    if (phase !== 'scroll') return
    const scroller = sheetElement()?.querySelector<HTMLElement>('[data-sheet-scroll]')
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      measure()
      // 送っている間に確定ボタンがなくなったら（ほかの端末で確定した、など）、確定の案内はとばす
      setPhase(confirmElement() ? 'confirm' : 'cover')
    }
    if (!scroller || scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2) {
      finish()
      return
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scroller.addEventListener('scrollend', finish, { once: true })
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
    const timer = setTimeout(finish, reduce ? 0 : SCROLL_MAX_MS)
    return () => {
      finished = true
      clearTimeout(timer)
      scroller.removeEventListener('scrollend', finish)
    }
  }, [phase, measure])

  // 暗い面が流れきったら、再生ボタンの案内へ
  useEffect(() => {
    if (phase !== 'cover') return
    const timer = setTimeout(() => setPhase('play'), COVER_MS)
    return () => clearTimeout(timer)
  }, [phase])

  // 押せる所へフォーカスを移す（キーボードでも進める）
  const ready = Boolean(sheet && play)
  useEffect(() => {
    if (!ready) return
    if (phase === 'sheet') next.current?.focus({ preventScroll: true })
    if (phase === 'confirm') confirmHole.current?.focus({ preventScroll: true })
    if (phase === 'play') hole.current?.focus({ preventScroll: true })
  }, [ready, phase])

  useSkipKey(onSkip)

  // 確定の段の途中で確定ボタンがなくなったら（ほかの端末で確定した、など）、押して進める所がなくなるので、再生ボタンの段へ進める
  if (phase === 'confirm' && !confirm) setPhase('play')

  if (!sheet || !play) return null

  // 1 つ目の矢印：シートの上の文字から、シートの上の縁へ下ろす
  const midX = sheet.left + sheet.width / 2
  const sheetTip = { x: midX + 8, y: sheet.top - 10 }
  const sheetTail = { x: midX - 6, y: sheet.top - 92 }
  const sheetBend = { x: midX + 34, y: sheet.top - 56 }

  // 再生ボタンの矢印：再生ボタンの右上の文字から、ボタンの右上へ曲がりながら下ろす
  const playRadius = Math.max(play.width, play.height) / 2 + HOLE_PAD
  const cx = play.left + play.width / 2
  const cy = play.top + play.height / 2
  const playTip = { x: cx + playRadius * 0.72 + 4, y: cy - playRadius * 0.72 - 4 }
  const playTail = { x: cx + 78, y: cy - playRadius - 76 }
  const playBend = { x: playTail.x + 6, y: playTip.y - 16 }

  // 確定ボタンの矢印：ボタンの上の文字から、ボタンの上の縁へ下ろす
  const confirmMidX = confirm ? confirm.left + confirm.width / 2 : 0
  const confirmTop = confirm ? confirm.top - CONFIRM_PAD : 0
  const confirmTip = { x: confirmMidX, y: confirmTop - 10 }
  const confirmTail = { x: confirmMidX - 22, y: confirmTop - 90 }
  const confirmBend = { x: confirmMidX - 46, y: confirmTop - 46 }

  // シートの文字を消す段（確定ボタンか再生ボタンの案内に移った）
  const sheetLeft = phase === 'confirm' || phase === 'play'
  const labelledBy = phase === 'play' ? playTextId : phase === 'confirm' ? confirmTextId : sheetTextId

  return createPortal(
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      {/* 暗い所の全体を覆う、見えないボタン。押すと案内をそこで終える（明るく残した所は、上に重ねたボタンが受ける） */}
      {/* 暗い面が流れているあいだ（cover）と一覧を送っているあいだ（scroll）は受けない。シートを素早く 2 回押して、次の段を見ずに終わらないように。キーボードでは Esc でとばす */}
      <button
        type="button"
        className={styles.skip}
        aria-label={translate('案内をとばす', 'Skip the guide')}
        tabIndex={-1}
        disabled={phase === 'cover' || phase === 'scroll'}
        onClick={onSkip}
      />
      {phase === 'confirm' && confirm ? (
        // 確定ボタンのまわりだけ明るく残す枠。押しても確定はせず、再生ボタンの案内へ進む
        <button
          ref={confirmHole}
          type="button"
          className={`${styles.hole} ${styles.confirmHole}`}
          style={{
            left: confirmMidX,
            top: confirm.top + confirm.height / 2,
            width: confirm.width + CONFIRM_PAD * 2,
            height: confirm.height + CONFIRM_PAD * 2,
            borderRadius: confirmRadius + CONFIRM_PAD,
          }}
          aria-label={translate('次へ', 'Next')}
          onClick={() => setPhase('play')}
        />
      ) : phase === 'play' ? (
        // 再生ボタンのまわりだけ明るく残す丸。ここだけが押せる
        <button
          ref={hole}
          type="button"
          className={`${styles.hole} ${styles.playHole}`}
          style={{ left: cx, top: cy, width: playRadius * 2, height: playRadius * 2 }}
          aria-label={translate('旅を再生する', 'Play trip')}
          onClick={onPlay}
        />
      ) : (
        // シートだけ明るく残す枠。押すと、確定ボタンの案内か、下へ流れて画面全体が暗くなる（下の端は画面の外まで伸ばして、角の丸みを見せない）。
        // 後ろのシートは押せず、次の段へ進むだけ
        <button
          ref={next}
          type="button"
          className={phase === 'sheet' ? `${styles.hole} ${styles.sheetHole} ${styles.sheetNext}` : `${styles.hole} ${styles.sheetHole}`}
          style={{
            left: sheet.left,
            top: sheet.top,
            width: sheet.width,
            height: Math.max(sheet.height, viewHeight - sheet.top) + radius,
            borderRadius: `${radius}px ${radius}px 0 0`,
            transform: phase === 'cover' ? `translateY(${viewHeight - sheet.top + 8}px)` : undefined,
          }}
          aria-label={translate('次へ', 'Next')}
          disabled={phase !== 'sheet'}
          onClick={fromSheet}
        />
      )}

      <div className={sheetLeft ? `${styles.guide} ${styles.leave}` : styles.guide} aria-hidden={sheetLeft}>
        <Arrow id={`${sheetTextId}-head`} from={sheetTail} bend={sheetBend} to={sheetTip} />
        <p id={sheetTextId} className={`${styles.label} ${styles.sheetLabel}`} style={{ left: sheet.left + 16, width: sheet.width - 32, bottom: viewHeight - sheetTail.y + 8 }}>
          <span>{translate('旅の行程が自動でしおりになるよ！', 'Your plan becomes an itinerary!')}</span>
          <span>{translate('自分で微調整もできるよ！', 'You can fine-tune it anytime.')}</span>
        </p>
      </div>

      {confirm && (phase === 'confirm' || phase === 'play') && (
        <div className={phase === 'play' ? `${styles.guide} ${styles.leave}` : `${styles.guide} ${styles.enter}`} aria-hidden={phase === 'play'}>
          <Arrow id={`${confirmTextId}-head`} from={confirmTail} bend={confirmBend} to={confirmTip} />
          <p
            id={confirmTextId}
            className={`${styles.label} ${styles.sheetLabel}`}
            style={{ left: confirm.left + 8, width: confirm.width - 16, bottom: viewHeight - confirmTail.y + 8 }}
          >
            <span>{translate('旅に満足したら確定しよう！', 'Happy with the trip? Lock it in!')}</span>
          </p>
        </div>
      )}

      {phase === 'play' && (
        <div className={`${styles.guide} ${styles.enter}`}>
          <Arrow id={`${playTextId}-head`} from={playTail} bend={playBend} to={playTip} />
          <p id={playTextId} className={styles.label} style={{ left: Math.max(16, play.left), bottom: viewHeight - playTail.y + 8 }}>
            <span>{translate('このボタンで旅を', 'Tap here to')}</span>
            <span>{translate('シミュレーションできるよ！', 'preview your trip!')}</span>
          </p>
        </div>
      )}
    </div>,
    document.body,
  )
}

interface Point {
  x: number
  y: number
}

/** 文字から明るく残した所へ向けた、少し曲がった矢印 */
function Arrow({ id, from, bend, to }: { id: string; from: Point; bend: Point; to: Point }) {
  return (
    <svg className={styles.arrow} width="100%" height="100%" aria-hidden="true">
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M1 1 L9 5 L1 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <path
        className={styles.stroke}
        d={`M ${from.x} ${from.y} Q ${bend.x} ${bend.y} ${to.x} ${to.y}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        markerEnd={`url(#${id})`}
      />
    </svg>
  )
}
