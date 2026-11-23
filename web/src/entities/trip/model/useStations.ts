import { useEffect, useState } from 'react'
import { loadStations } from './stations'

/** 全国の駅の表を読み込み、読み込めたら true を返す（読み込めたら描き直して、駅の位置を引けるようにする） */
export function useStations(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    loadStations()
      .then(() => alive && setReady(true))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return ready
}
