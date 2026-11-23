import { useState } from 'react'
import { useSession } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { confirmShiori, refusalMessage } from '../api/confirmShiori'

/**
 * 旅程を確定する・取り消す操作（企画書「ユーザー体験」3-6）。うまくいったら onDone を呼ぶ（確定ならしおりビューを開く、取り消しなら地図の見えるしおりに戻す）。
 * 断られたときは、Functions が返した理由（建物を作っている途中、など）をお知らせに出して元のまま
 */
export function useConfirmShiori(tripId: string, onDone: () => void) {
  const session = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  /** 確定する・取り消す。できたら true（断られた、失敗したら、お知らせを出して false） */
  async function run(confirm: boolean): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    try {
      await confirmShiori(session, tripId, confirm)
      playSound(confirm ? 'build-complete' : 'close')
      toast(confirm ? translate('旅程を確定しました。しおりができました', "The itinerary is finalized.") : translate('確定を取り消しました。また全員で計画できます', "The itinerary is open for everyone to edit again."))
      onDone()
      return true
    } catch (error) {
      playSound('error')
      // 理由が分かるもの（発案者でない、場所がない、建物を作っている途中）は、その文を出す
      toast(refusalMessage(error) ?? (confirm ? translate('確定できませんでした。もう一度試してください', "Couldn't finalize the itinerary. Try again.") : translate('取り消せませんでした。もう一度試してください', "Couldn't reopen the itinerary. Try again.")))
      return false
    } finally {
      setBusy(false)
    }
  }

  return { confirm: () => run(true), unconfirm: () => run(false), busy }
}
