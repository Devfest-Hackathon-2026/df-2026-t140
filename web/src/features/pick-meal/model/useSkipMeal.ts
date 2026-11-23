import { useState } from 'react'
import { useSession } from '@/shared/api'
import { playSound, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { setMeal } from '../api/setMeal'

/**
 * ごはんの枠を、お店を建てずに決める（「なし」「コンビニ」など）ことと、その取り消し（企画書「ユーザー体験」3-7 の 8）。
 * 保存できたら、ルートの購読で枠が変わる。ほかの人が先にお店を建てていたときと、保存できなかったときは、お知らせを出す
 */
export function useSkipMeal(tripId: string, routeId: string) {
  const session = useSession()
  const toast = useToast()
  // 保存を待っている枠（押したボタンを、その間は押せなくする）
  const [saving, setSaving] = useState<string | null>(null)

  async function setSkip(slot: string, skip: boolean, note?: string): Promise<boolean> {
    if (saving !== null) return false
    playSound(skip ? 'select' : 'close')
    setSaving(slot)
    try {
      const status = await setMeal(session, { tripId, routeId, slot, skip, note: note?.trim() || null })
      if (status === 'decided') toast(translate('このごはんのお店は、もう決まっています', 'A restaurant has already been chosen for this meal.'))
      else if (status === 'confirmed') toast(translate('旅程が確定しているので、ごはんの枠は変えられません', "You can't change meals while the itinerary is finalized."))
      else if (status !== 'changed' && status !== 'unchanged') throw new Error(status)
      return status === 'changed' || status === 'unchanged'
    } catch {
      playSound('error')
      toast(translate('ごはんの枠を変えられませんでした。もう一度試してください', "Couldn't update the meal. Try again."))
      return false
    } finally {
      setSaving(null)
    }
  }

  return { setSkip, saving }
}
