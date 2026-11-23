import { useState } from 'react'
import { useSession } from '@/shared/api'
import { playSound, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { setLodging } from '../api/setLodging'

/**
 * 宿の枠で、宿を取らない夜にする（過ごし方を自分で書ける）ことと、その取り消し、前の夜と同じ宿にすること（企画書「ユーザー体験」3-7）。
 * 保存できたら、ルートの購読で枠が変わる。ほかの人が先に宿を建てていたときと、保存できなかったときは、お知らせを出す
 */
export function useSkipLodging(tripId: string, routeId: string) {
  const session = useSession()
  const toast = useToast()
  // 保存を待っている夜（押したボタンを、その間は押せなくする）
  const [saving, setSaving] = useState<number | null>(null)

  async function setSkip(night: number, skip: boolean, note?: string): Promise<boolean> {
    if (saving !== null) return false
    playSound(skip ? 'select' : 'close')
    setSaving(night)
    try {
      const status = await setLodging(session, { tripId, routeId, night, skip, note: note?.trim() || null })
      if (status === 'decided') toast(translate('この夜の宿は、もう決まっています', 'Lodging has already been chosen for this night.'))
      else if (status === 'confirmed') toast(translate('旅程が確定しているので、宿の枠は変えられません', "You can't change lodging while the itinerary is finalized."))
      else if (status !== 'changed' && status !== 'unchanged') throw new Error(status)
      return status === 'changed' || status === 'unchanged'
    } catch {
      playSound('error')
      toast(translate('宿の枠を変えられませんでした。もう一度試してください', "Couldn't update the overnight plan. Try again."))
      return false
    } finally {
      setSaving(null)
    }
  }

  /** その夜を、前の夜と同じ宿にする（同じ宿に 2 泊以上する）。保存できたら true */
  async function setSame(night: number): Promise<boolean> {
    if (saving !== null) return false
    playSound('select')
    setSaving(night)
    try {
      const status = await setLodging(session, { tripId, routeId, night, same: true })
      if (status === 'decided') toast(translate('この夜の宿は、もう決まっています', 'Lodging has already been chosen for this night.'))
      else if (status === 'confirmed') toast(translate('旅程が確定しているので、宿の枠は変えられません', "You can't change lodging while the itinerary is finalized."))
      else if (status === 'no-previous') toast(translate('前の夜の宿がまだ決まっていません', "The previous night's lodging hasn't been chosen yet."))
      else if (status === 'full') toast(translate('しおりの行がいっぱいなので、宿を足せません', "The itinerary is full, so lodging can't be added."))
      else if (status === 'stale') toast(translate('前の夜の宿が変わりました。もう一度試してください', "The previous night's lodging changed. Try again."))
      else if (status !== 'changed') throw new Error(status)
      return status === 'changed'
    } catch {
      playSound('error')
      toast(translate('宿の枠を変えられませんでした。もう一度試してください', "Couldn't update the overnight plan. Try again."))
      return false
    } finally {
      setSaving(null)
    }
  }

  return { setSkip, setSame, saving }
}
