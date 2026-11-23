import { useState } from 'react'
import { type DateRange, pickDateRange } from '@/entities/trip'
import { useSession } from '@/shared/api'
import { playSound, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { changeTripDates, refusalMessage } from '../api/changeTripDates'

/**
 * 旅の設定で、発案者が日程を選び直す操作。開く → カレンダーで行く日と帰る日を押す → 保存する。
 * 保存すると Functions がしおりを組み直す。入りきらずに外れた場所があれば、その数をお知らせに出す
 */
export function useEditTripDates(tripId: string, startDate: string, endDate: string | null) {
  const session = useSession()
  const toast = useToast()
  const [range, setRange] = useState<DateRange | null>(null)
  const [busy, setBusy] = useState(false)

  const open = () => setRange({ start: startDate, end: endDate, awaitingEnd: false })
  const close = () => setRange(null)
  const pick = (date: string) => {
    playSound('select')
    setRange((now) => (now ? pickDateRange(now, date) : now))
  }

  async function save(): Promise<void> {
    if (!range || busy) return
    if (range.start === startDate && range.end === endDate) {
      close()
      return
    }
    setBusy(true)
    try {
      const { leftOut, restored } = await changeTripDates(session, tripId, range.start, range.end)
      playSound('select')
      toast(leftOut > 0 && restored > 0
        ? translate(`日程を変えました。入りきらない ${leftOut} か所をしおりから外し、外れていた ${restored} か所を戻しました`, `Dates changed. ${leftOut} ${leftOut === 1 ? 'place was' : 'places were'} removed and ${restored} ${restored === 1 ? 'place was' : 'places were'} added back.`)
        : leftOut > 0
        ? translate(`日程を変えました。入りきらない ${leftOut} か所をしおりから外しました`, `Dates changed. ${leftOut} ${leftOut === 1 ? 'place that no longer fits was' : 'places that no longer fit were'} removed from the itinerary.`)
        : restored > 0
          ? translate(`日程を変えました。外れていた ${restored} か所をしおりに戻しました`, `Dates changed. ${restored} ${restored === 1 ? 'place was' : 'places were'} added back to the itinerary.`)
          : translate('日程を変えました', 'Dates changed.'))
      close()
    } catch (error) {
      playSound('error')
      toast(refusalMessage(error) ?? translate('日程を変えられませんでした。もう一度試してください', "Couldn't change the dates. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return { range, open, close, pick, save, busy, editing: range !== null }
}
