import { useState } from 'react'
import { useSession } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { removeBuilding } from '../api/removeBuilding'

/**
 * 建った建物を消す操作（企画書「ユーザー体験」3-6）。
 * 消し終わると、ピンの購読で建物が地図から消え、場所カードも閉じる。消せなかったときは、お知らせを出して元のまま
 */
export function useRemoveBuilding(tripId: string, pinId: string) {
  const session = useSession()
  const toast = useToast()
  const [removing, setRemoving] = useState(false)

  async function remove(): Promise<void> {
    if (removing) return
    setRemoving(true)
    try {
      await removeBuilding(session, tripId, pinId)
      playSound('close')
      toast(translate('建物を消しました', "Building removed."))
    } catch {
      playSound('error')
      toast(translate('建物を消せませんでした。もう一度試してください', "Couldn't remove the building. Try again."))
    } finally {
      setRemoving(false)
    }
  }

  return { remove, removing }
}
