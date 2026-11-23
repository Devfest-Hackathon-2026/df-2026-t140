import { useState } from 'react'
import { DIVE_MS } from '@/widgets/trip-map'

/**
 * 最後の旅の名前の問いで「ここへ出発！」を押したときの動き。旅を作るのと、地図が選んだ場所へ寄るのを一緒に進め、
 * 両方が済んだら onArrived（旅の画面へ移る）。作れなかったら元の形に戻す（理由は作る側が problem に入れ、シートに出す）
 */
export function useDepart(create: () => Promise<string | null>, onArrived: (tripId: string) => void) {
  // 「ここへ出発！」を押してから、旅の画面へ移るまで
  const [departing, setDeparting] = useState(false)

  const depart = async () => {
    if (departing) return
    setDeparting(true)
    const [tripId] = await Promise.all([create(), new Promise((done) => setTimeout(done, DIVE_MS))])
    if (tripId) onArrived(tripId)
    else setDeparting(false)
  }

  return { departing, depart }
}
