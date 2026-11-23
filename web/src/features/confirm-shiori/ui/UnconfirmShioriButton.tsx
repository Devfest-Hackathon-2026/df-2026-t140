import { type SyntheticEvent, useEffect, useRef, useState } from 'react'
import { translate, playSound } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import { useConfirmShiori } from '../model/useConfirmShiori'
import styles from './ConfirmShiori.module.css'

interface Props {
  tripId: string
  /** 取り消せたとき（地図の見えるしおりに戻す） */
  onUnconfirmed: () => void
}

/** 確認の中の操作が、うしろのシートのドラッグに取られないようにする */
const stop = (event: SyntheticEvent) => event.stopPropagation()

/**
 * 「確定を取り消す」。確定したあとのしおりビュー（S14）の一番下に置く。押せるのは発案者だけなので、出すかどうかは置く側が決める。
 * 押すと確認を 1 回出し、「取り消す」を選んだときだけ取り消す（建物を消すボタンと同じ形の確認）。
 * 見た目は白地に濃い字、縁と下の厚みのあるふつうのボタンに、戻す向きの矢印を添える（押せると分かるように。UI/UX レビューの F-2。#708）
 */
export function UnconfirmShioriButton({ tripId, onUnconfirmed }: Props) {
  const { unconfirm, busy } = useConfirmShiori(tripId, onUnconfirmed)
  const [asking, setAsking] = useState(false)
  const dialog = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (asking && !element.open) {
      element.showModal()
      // 最初のフォーカスは確認そのものに置く（タップで開いたときに、ボタンに青い輪郭を出さない。#372）
      element.focus()
    }
    if (!asking && element.open) element.close()
  }, [asking])

  const cancel = () => {
    playSound('close')
    setAsking(false)
  }
  const confirm = async () => {
    await unconfirm()
    setAsking(false)
  }

  return (
    <>
      <Button sound="attention" block className={styles.button} onClick={() => setAsking(true)}>
        <Icon name="undo" />
        {translate('確定を取り消す', 'Reopen itinerary')}
      </Button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        tabIndex={-1}
        aria-labelledby={`unconfirm-${tripId}`}
        onCancel={(event) => {
          event.preventDefault()
          if (!busy) cancel()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) cancel()
        }}
        onPointerDown={stop}
        onPointerUp={stop}
        onPointerMove={stop}
        onPointerCancel={stop}
      >
        <div className={styles.body}>
          <p id={`unconfirm-${tripId}`} className={styles.question}>
            {translate('確定を取り消しますか？', 'Reopen the itinerary?')}
          </p>
          <p className={styles.detail}>{translate('全員がまた旅程を直せるようになります。書き出したしおりとずれることがあります。', "Everyone will be able to edit the itinerary again. Exported copies may no longer match.")}</p>
          <div className={styles.buttons}>
            <Button onClick={cancel} disabled={busy}>
              {translate('やめる', 'Cancel')}
            </Button>
            <Button variant="destroy" onClick={() => void confirm()} disabled={busy}>
              {busy ? translate('取り消しています…', "Reopening…") : translate('取り消す', "Reopen")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
}
