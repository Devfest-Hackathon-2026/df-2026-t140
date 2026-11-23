import { useState } from 'react'
import { memberNameProblem, recallMyName, rememberMyName } from '@/entities/member'
import {
  issueJoinCode,
  loadStations,
  lookupOrigin,
  originLocation,
  type OriginPoint,
  type PickedPrefectures,
  regionsOfPicked,
  regionsProblem,
  originProblem,
  provisionalTripTitle,
  toTripArea,
  type TravelMode,
  type TripInfo,
  tripInfoProblem,
} from '@/entities/trip'
import { useSession } from '@/shared/api'
import { playSound, today, translate as t } from '@/shared/lib'
import { createTrip } from '../api/createTrip'
import { memoOriginLookup, type OriginResult } from './originLookup'

/**
 * 旅をつくる入力の状態と、作る操作。
 * 入力（日程・出発地・帰る場所・名前・乗り物・旅の名前）を 1 問ずつ受け、最後に大まかな場所（選んだ県）を渡して create で作る
 * （場所は、日本全体の地図で選ぶ画面をページが持つ。最後の旅の名前の問いで「ここへ出発！」を押したときに作る）。
 * 帰る場所（旅の最後にいたい場所）は、打ち変えるまで出発地と同じ（goal は null）。出発地と違うときだけ旅に書く。
 * 旅の名前が空なら、選んだ場所から作った仮の名前（「北陸の旅」）で作る（Takana の依頼、2026-11-22）
 */
export function useCreateTrip() {
  const session = useSession()
  const [info, setInfoState] = useState<TripInfo>({ title: '', startDate: today(), endDate: null, origin: '' })
  const [name, setNameState] = useState(recallMyName)
  // 帰る場所。打ち変えるまでは null（出発地と同じ）
  const [goal, setGoalState] = useState<string | null>(null)
  // 移動手段の既定は電車・バス（車を出せない人もいるため。しおりで誰でも選び直せる）
  const [travelMode, setTravelMode] = useState<TravelMode>('transit')
  const [problem, setProblem] = useState<string | null>(null)
  // 決定を押して引いた出発地の位置。旅を作るときに名前が同じならこれを使い、もう一度は引かない
  const [located, setLocated] = useState<OriginPoint | null>(null)
  // 出発地を引く関数。同じ名前は、引いている途中も、見つからなかったときも含めて引き直さない（Places を何度も呼ばないように。model/originLookup.ts）
  const [lookup] = useState(() => memoOriginLookup(originLocation, (name) => lookupOrigin(session, name)))

  // 入力を直したら、前の注意は消す
  const setInfo = (value: TripInfo) => {
    setInfoState(value)
    setProblem(null)
  }
  const setName = (value: string) => {
    setNameState(value)
    setProblem(null)
  }
  const setGoal = (value: string | null) => {
    setGoalState(value)
    setProblem(null)
  }

  /** 出発地の位置を引き、引けたら地図に家を立てるために覚える（入力して決定を押したとき、つぎへで進んだとき） */
  async function locate(name: string): Promise<OriginResult['status']> {
    const trimmed = name.trim()
    if (!trimmed) return 'not-found'
    // 全国の駅の表を読み終えてから引く（読み終える前だと「新宿御苑前」が「新宿」の位置になるため）。読めなければ表なしで引く
    await loadStations().catch(() => {})
    const result = await lookup(trimmed)
    if (result.status === 'resolved') setLocated(result.point)
    return result.status
  }

  /** 旅を作る。作れたら旅の ID、作れなかったら null を返す（理由は problem に入る）。名前が空なら、選んだ場所から作った仮の名前 */
  async function create(picked: PickedPrefectures): Promise<string | null> {
    const tripInfo = { ...info, title: info.title.trim() || provisionalTripTitle(picked) }
    const found = tripInfoProblem(tripInfo) ?? regionsProblem(regionsOfPicked(picked)) ?? memberNameProblem(name)
    setProblem(found)
    if (found) {
      playSound('attention')
      return null
    }
    try {
      // 出発地は、出発地の問いで引いた結果を使う（引いている途中なら待つ）。出発の時点で関数を呼び直さないので、待ちが短い
      const origin = tripInfo.origin.trim()
      await loadStations().catch(() => {})
      const result = await lookup(origin)
      if (result.status === 'error') throw new Error(t('旅を作れませんでした。電波のよいところで、もう一度押してください。', 'Could not create the trip. Check your connection and try again.'))
      if (result.status !== 'resolved') {
        setProblem(originProblem(result.status))
        playSound('attention')
        return null
      }
      const originPoint = result.point
      // 帰る場所が出発地と違うときだけ、その位置も引く（同じなら旅に書かず、出発地へ帰る）
      const goalName = (goal ?? origin).trim()
      let returnPoint: OriginPoint | undefined
      if (goalName && goalName !== origin) {
        const found = await lookup(goalName)
        if (found.status === 'error') throw new Error(t('旅を作れませんでした。電波のよいところで、もう一度押してください。', 'Could not create the trip. Try again where the connection is better.'))
        if (found.status !== 'resolved') {
          setProblem(t('帰る場所が見つかりませんでした。「最後はどこに帰る？」まで戻って、駅の名前を入れてください。', 'We couldn’t find where the trip ends. Go back to “Where does the trip end?” and enter a station name.'))
          playSound('attention')
          return null
        }
        returnPoint = found.point
      }
      const tripId = await createTrip(session, tripInfo, toTripArea(picked), name, originPoint, travelMode, returnPoint)
      rememberMyName(name)
      // 旅の合言葉を、招待の画面が出る前に作り始める（待たない。地図が選んだ場所へ寄っていくあいだに届き、招待の画面ですぐ出る）。
      // 作れなくても、招待の画面がもう一度頼む
      issueJoinCode(session, tripId).catch((cause: unknown) => console.error(cause))
      return tripId
    } catch (cause) {
      playSound('error')
      setProblem(cause instanceof Error && !('code' in cause) ? cause.message : t('旅を作れませんでした。電波のよいところで、もう一度押してください。', 'Could not create the trip. Check your connection and try again.'))
      return null
    }
  }

  return { info, setInfo, name, setName, goal, setGoal, travelMode, setTravelMode, problem, create, located, locate }
}

export type CreateTripState = ReturnType<typeof useCreateTrip>
