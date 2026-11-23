import { type SyntheticEvent, useEffect, useId, useRef } from 'react'
import { clockLabel, translate } from '@/shared/lib'
import { Button } from '@/shared/ui'
import type { StopTimeClash } from '../model/useStopTime'
import styles from './ClashDialog.module.css'

interface Props {
  /** 確かめていること。null なら閉じる */
  clash: StopTimeClash | null
  /** 「このまま変える」 */
  onKeep: () => void
  /** 「やめる」、外側、Esc */
  onDrop: () => void
}

/** 確認の中の操作が、うしろのしおりのシートのスワイプやドラッグに取られないようにする */
const stop = (event: SyntheticEvent) => event.stopPropagation()

/**
 * 時刻を直すと、時刻が決まったイベント（花火大会、見学会）の時間と重なるときに、確定する前に出す確認（#581）。
 * 重なるときだけ出し、近いだけのときは出さない（Takana の決定、2026-11-21）。「やめる」なら元の時刻に戻る
 */
export function ClashDialog({ clash, onKeep, onDrop }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  // しおりの時刻ごとに 1 つずつ描くので、見出しの id は時刻ごとに分ける
  const titleId = useId()

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (clash && !element.open) {
      element.showModal()
      // タップで開いても最初のボタンに青い輪郭が出ないよう、最初のフォーカスは確認そのものに置く（RemoveBuildingButton と同じ）
      element.focus()
    }
    if (!clash && element.open) element.close()
  }, [clash])

  const names = clash?.names.length
    ? clash.names.map((name) => translate(`「${name}」`, `“${name}”`)).join(translate('、', ', '))
    : translate('イベント', 'an event')
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      tabIndex={-1}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDrop()
      }}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onPointerCancel={stop}
    >
      <div className={styles.body}>
        <p id={titleId} className={styles.question}>
          {clash ? translate(`${clockLabel(clash.minutes)} にすると、${names}と時間が重なります`, `At ${clockLabel(clash.minutes)}, this overlaps with ${names}`) : ''}
        </p>
        <p className={styles.detail}>{translate('イベントの時刻は動きません。このまま変えますか？', "Event times can't move. Change it anyway?")}</p>
        <div className={styles.buttons}>
          <Button onClick={onDrop}>{translate('やめる', 'Cancel')}</Button>
          <Button variant="go" onClick={onKeep}>
            {translate('このまま変える', 'Change anyway')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
