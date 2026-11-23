import { type SyntheticEvent, useEffect, useRef, useState } from 'react'
import { translate, playSound } from '@/shared/lib'
import { Button } from '@/shared/ui'
import { useRemoveBuilding } from '../model/useRemoveBuilding'
import styles from './RemoveBuildingButton.module.css'

interface Props {
  tripId: string
  pinId: string
}

/** 確認の中の操作が、うしろの場所カードのスワイプやドラッグに取られないようにする */
const stop = (event: SyntheticEvent) => event.stopPropagation()

/**
 * 「建物を消す」。場所カード（S05）の一番下に置く、横長の赤いボタン。
 * 押しまちがいを防ぐため、押すと確認を出し、「消す」（右、赤）を選んだときだけ消す。「消さない」か、外側を押すと閉じる
 */
export function RemoveBuildingButton({ tripId, pinId }: Props) {
  const { remove, removing } = useRemoveBuilding(tripId, pinId)
  const [asking, setAsking] = useState(false)
  const dialog = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (asking && !element.open) {
      element.showModal()
      // showModal() は最初のボタン（消さない）にフォーカスを当て、タップで開いても青い輪郭が出てしまう（#372）。
      // 最初のフォーカスは確認そのものに置く。Tab で「消さない」「消す」に移れば、:focus-visible の輪郭が出る
      element.focus()
    }
    if (!asking && element.open) element.close()
  }, [asking])

  const cancel = () => {
    playSound('close')
    setAsking(false)
  }
  // 消せたら、ピンの購読で場所カードごと閉じる。消せなかったら、お知らせを出して確認だけを閉じる
  const confirm = async () => {
    await remove()
    setAsking(false)
  }

  return (
    <>
      <Button sound="attention" variant="destroy" block className={styles.open} onClick={() => setAsking(true)}>
        {translate('建物を消す', 'Remove building')}
      </Button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        tabIndex={-1}
        aria-labelledby={`remove-building-${pinId}`}
        // Esc で閉じたとき
        onCancel={(event) => {
          event.preventDefault()
          if (!removing) cancel()
        }}
        // 外側（暗いところ）を押したら閉じる
        onClick={(event) => {
          if (event.target === event.currentTarget && !removing) cancel()
        }}
        onPointerDown={stop}
        onPointerUp={stop}
        onPointerMove={stop}
        onPointerCancel={stop}
      >
        <div className={styles.body}>
          <p id={`remove-building-${pinId}`} className={styles.question}>
            {translate('本当に建物を削除しますか？', 'Remove this building?')}
          </p>
          <p className={styles.detail}>{translate('全員の地図としおりから消えます。', "This removes it from everyone's map and itinerary.")}</p>
          <div className={styles.buttons}>
            <Button onClick={cancel} disabled={removing}>
              {translate('消さない', 'Cancel')}
            </Button>
            <Button variant="destroy" onClick={() => void confirm()} disabled={removing}>
              {removing ? translate('消しています…', "Removing…") : translate('消す', "Remove")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
}
