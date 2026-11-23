import { useMemo, useState } from 'react'
import type { Member } from '@/entities/member'
import type { ModelJson } from '@/entities/model3d'
import type { WithId } from '@/shared/api'
import { playSound } from '@/shared/lib'
import { useCollection } from '@/widgets/collection'
import type { MapFocus } from '@/widgets/trip-map'

/**
 * 日本コレクションに出すもの：過去のすべての旅の建物を、旅の地図の部品（TripMap）に渡す形にしたもの。
 * 建物の ID は、旅をまたいで 1 つに決まる名前（CollectionBuilding の key）にする（旅が違えば、ピンの ID が同じでも別の建物）
 */
export function useCollectionMap() {
  const collection = useCollection()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  // さっき押して寄った、まとめた代表の建物。寄っても分かれなかったとき、もう一度押したら詳細を出すのに使う
  const [zoomedKey, setZoomedKey] = useState<string | null>(null)

  const buildings = useMemo(() => collection.trips.flatMap((group) => group.buildings), [collection.trips])
  const pins = useMemo(() => buildings.map((building) => ({ ...building.pin, id: building.key })), [buildings])
  // 名札に出す、希望を書いた人。同じ人がいくつかの旅にいるときは、新しい旅での名前と色にする
  const members = useMemo(() => {
    const byId = new Map<string, WithId<Member>>()
    for (const { wisher } of buildings) if (wisher && !byId.has(wisher.id)) byId.set(wisher.id, wisher)
    return [...byId.values()]
  }, [buildings])
  const models = useMemo(() => {
    const loaded: Record<string, ModelJson> = {}
    for (const building of buildings) if (building.model) loaded[building.key] = building.model
    return loaded
  }, [buildings])

  return {
    loading: collection.loading,
    trips: collection.trips,
    pins,
    members,
    models,
    total: buildings.length,
    /** 詳細を出している建物。出していなければ null */
    selected: buildings.find((building) => building.key === selectedKey) ?? null,
    /**
     * 建物を押したとき。印のない所を押したら null（詳細を閉じる）。
     * 近くの建物をまとめた代表（count が 2 以上）を押したときは、詳細を出さずに、まとめた建物が分かれて見える所まで寄る
     * （代表 1 つの詳細だけが開いて、ほかの建物を開けなくならないように）。
     * 寄っても分かれない建物（同じ場所に建てたもの、ごく近いもの）もあるので、同じ代表を続けて押したら、代表の詳細を出す
     */
    select: (key: string | null, count = 1) => {
      const building = key ? buildings.find((one) => one.key === key) : undefined
      if (building && count > 1 && zoomedKey !== building.key) {
        playSound('select')
        setZoomedKey(building.key)
        setFocus({ key: `${building.key}/${Date.now()}`, spot: building.pin.location, pinId: building.key })
        return
      }
      setZoomedKey(null)
      if (key) playSound('open')
      setSelectedKey(key)
    },
    close: () => setSelectedKey(null),
    focus,
    /** 旅の名前を押したとき。その旅の建物が全部入る所へ寄る */
    focusTrip: (tripId: string) => {
      const keys = buildings.filter((building) => building.trip.id === tripId).map((building) => building.key)
      if (keys.length > 0) setFocus({ key: `${tripId}/${Date.now()}`, pinIds: keys })
    },
  }
}
