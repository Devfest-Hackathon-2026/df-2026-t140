import { useState } from 'react'
import { playSound } from '@/shared/lib'
import { useCollection } from '@/widgets/collection'

/** コレクション画面に出すもの：過去の旅ごとの建物と、詳細を出している建物 */
export function useCollectionPage() {
  const collection = useCollection()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const buildings = collection.trips.flatMap((group) => group.buildings)
  return {
    ...collection,
    /** 建物の数（全部の旅の合計） */
    total: buildings.length,
    /** 詳細を出している建物。出していなければ null */
    selected: buildings.find((building) => building.key === selectedKey) ?? null,
    select: (key: string) => {
      playSound('open')
      setSelectedKey(key)
    },
    close: () => setSelectedKey(null),
  }
}
