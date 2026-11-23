import type { ReactNode } from 'react'
import { translate } from '@/shared/lib'
import { Button } from '@/shared/ui'
import { useConfirmShiori } from '../model/useConfirmShiori'
import styles from './ConfirmShiori.module.css'

interface Props {
  tripId: string
  /** 確定できたとき（しおりビューを開く） */
  onConfirmed: () => void
  /** 確定できない理由（宿の決まっていない夜がある、など）。あると、ボタンを押せなくして、上に理由を出す */
  blocked?: string | null
  /** 確定できない理由の下に置く、それを片づけに行くボタン（「＋ 1 日目の宿を決める」。UI/UX レビューの S-4）。置く側が渡す */
  blockedAction?: ReactNode
}

/**
 * 「この旅で決まり！」。地図の見えるしおり（S11）のシートの一番下に置く、横長の緑のボタン。
 * 宿の決まっていない夜が残っているあいだは押せず、ボタンの上に理由を出す（企画書「ユーザー体験」3-7）。
 * 確認は出さず、押すとすぐ確定する（取り消せるので）。旅の名前は旅をつくる最後の問いで決めるので、ここでは聞かない
 * （Takana の依頼、2026-11-22）。押せるのは発案者だけなので、出すかどうかは置く側が決める
 */
export function ConfirmShioriButton({ tripId, onConfirmed, blocked, blockedAction }: Props) {
  const { confirm, busy } = useConfirmShiori(tripId, onConfirmed)
  return (
    <>
      {blocked && <p className={styles.blocked}>{blocked}</p>}
      {blocked && blockedAction}
      {/* しおりの中の案内（pages/trip-map の ShioriGuide）が、この印で探して指す */}
      <Button variant="go" block className={styles.button} data-guide="shiori-confirm" onClick={() => void confirm()} disabled={busy || Boolean(blocked)}>
        {busy ? translate('確定しています…', 'Finalizing…') : translate('この旅で決まり！', 'Lock in this trip!')}
      </Button>
    </>
  )
}
