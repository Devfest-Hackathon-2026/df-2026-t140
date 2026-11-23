import { useState } from 'react'
import { useSession } from '@/shared/api'
import { playSound, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { repeatVisit } from '../api/repeatVisit'

/**
 * しおりの行を複製する・消す操作（企画書「ユーザー体験」3-6、#528）。
 * 終わると、ルートの購読でしおりが変わる。できなかったときは、お知らせを出して元のまま。頼んでいるあいだは、次の操作を受けない
 */
export function useRepeatVisit(tripId: string, routeId: string, stopId: string) {
  const session = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run(remove: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const status = await repeatVisit(session, tripId, routeId, stopId, remove)
      if (status === 'changed') {
        playSound(remove ? 'close' : 'switch')
        toast(remove ? translate('しおりの行を 1 つ消しました', 'Stop removed.') : translate('同じ場所をもう 1 回入れました', 'Another stop added.'))
      } else {
        playSound('error')
        // 40 行は Functions の MAX_STOPS（functions/src/domain/visit.ts）。変えるときは、ここも合わせる
        toast(status === 'full'
          ? translate('しおりに入れられるのは 40 行までです', 'The itinerary can have up to 40 stops.')
          : translate('しおりが変わっていました。もう一度試してください', 'The itinerary has changed. Try again.'))
      }
    } catch {
      playSound('error')
      toast(remove
        ? translate('行を消せませんでした。もう一度試してください', "Couldn't remove the stop. Try again.")
        : translate('同じ場所を入れられませんでした。もう一度試してください', "Couldn't add another stop. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return { add: () => run(false), remove: () => run(true), busy }
}
