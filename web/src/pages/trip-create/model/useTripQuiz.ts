import { useRef, useState } from 'react'
import { ALL_PREFECTURES, type PickedPrefectures, provisionalTripTitle, suggestTripTitle, type TravelMode, type TripInfo } from '@/entities/trip'
import type { CreateTripState } from '@/features/create-trip'
import { useSession } from '@/shared/api'
import { appLanguage, playSound, prepareSounds, translate as t } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { type OriginFinding, originFindingReaction } from './quizAnswers'
import { canGoNext, pickQuizDate, quizReaction, quizSteps } from './tripQuiz'

/**
 * 旅をつくる画面（S01）の 1 問 1 答の状態と操作。答えそのもの（日程・出発地・帰る場所・名前・乗り物・旅の名前）は
 * features/create-trip の入力の状態に入れ、ここは「今どの問いか」と、日程・乗り物を選んだか、旅の名前を打ったかだけを持つ
 */
export function useTripQuiz(state: CreateTripState) {
  const session = useSession()
  const toast = useToast()
  // 名前を覚えている人には聞かない（開いたときに決め、途中で問いの数を変えない）
  const [steps] = useState(() => quizSteps(state.name.trim() === ''))
  const [index, setIndex] = useState(0)
  const [dated, setDated] = useState(false)
  const [awaitingEnd, setAwaitingEnd] = useState(false)
  const [mode, setMode] = useState<TravelMode | null>(null)
  // 出発地を引いている様子と、引いた名前（名前を打ち直したら消す）
  const [finding, setFinding] = useState<{ name: string; status: OriginFinding } | null>(null)
  // 旅の名前を自分で打ったか（打つまでは、選んだ場所から作った仮の名前を入れておき、場所を選び直すと入れ直す）
  const [titleTyped, setTitleTyped] = useState(false)
  // Gemini が名前を考えているか。頼んだ回の番号で、打ち直したり頼み直したりしたあとに届いた古い名前は入れない
  const [thinking, setThinking] = useState(false)
  const asked = useRef(0)

  const step = steps[index]
  const answers = { name: state.name, info: state.info, dated, awaitingEnd, mode, goal: state.goal }

  const pickDate = (date: string) => {
    prepareSounds()
    playSound('select')
    const next = pickQuizDate(answers, date)
    state.setInfo(next.info)
    setDated(next.dated)
    setAwaitingEnd(next.awaitingEnd)
  }
  const pickMode = (value: TravelMode) => {
    prepareSounds()
    playSound('select')
    setMode(value)
    state.setTravelMode(value)
  }
  const setInfo = (info: TripInfo) => state.setInfo(info)
  /** 出発地を変える（打つ、チップを押す）。前に引いた様子は消す */
  const setOrigin = (origin: string) => {
    setFinding(null)
    state.setInfo({ ...state.info, origin })
  }
  /**
   * 出発地を引いて、地図に家を立てる（決定を押したとき。つぎへで進んだときも裏で引く）。
   * quiet：つぎへで進んだとき。見つからなくても音は鳴らさない（別の問いの画面で鳴っても、なぜか分からないため）
   */
  const locateOrigin = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const name = state.info.origin.trim()
    if (!name || state.located?.name === name) return
    setFinding({ name, status: 'finding' })
    const status = await state.locate(name)
    setFinding((current) => (current?.name === name ? { name, status } : current))
    if (status !== 'resolved' && !quiet) playSound('attention')
  }

  /** 帰る場所を変える（打つ、チップを押す）。出発地と同じにしたら、出発地に合わせる形（null）に戻す */
  const setGoal = (goal: string) => state.setGoal(goal.trim() === state.info.origin.trim() ? null : goal)
  /** 旅の名前を打つ。考えている途中なら、届く名前は入れない（打った名前を上書きしない） */
  const setTitle = (title: string) => {
    asked.current += 1
    setThinking(false)
    setTitleTyped(true)
    state.setInfo({ ...state.info, title })
  }
  /** 旅の名前を Gemini に考えてもらう（本物の Gemini を使えないときは、関数が季節と行き先から作った名前を返す） */
  async function askGemini(picked: PickedPrefectures): Promise<void> {
    if (thinking) return
    prepareSounds()
    playSound('select')
    asked.current += 1
    const turn = asked.current
    setThinking(true)
    try {
      const suggested = await suggestTripTitle(session, {
        startDate: state.info.startDate,
        endDate: state.info.endDate,
        origin: state.info.origin.trim(),
        travelMode: state.travelMode,
        prefectures: picked.length > 0 ? picked : [...ALL_PREFECTURES],
        language: appLanguage,
      })
      if (turn !== asked.current) return
      setTitleTyped(true)
      state.setInfo({ ...state.info, title: suggested })
      playSound('discover')
    } catch (cause) {
      console.error(cause)
      if (turn !== asked.current) return
      playSound('error')
      toast(t('Gemini が名前を考えられませんでした。名前を入れてください', 'Gemini could not think of a name. Please enter one.'))
    } finally {
      if (turn === asked.current) setThinking(false)
    }
  }
  /** 行き先を選んで、最後の旅の名前の問いへ進む。まだ名前を打っていなければ、選んだ場所から作った仮の名前を入れておく */
  const toTitle = (picked: PickedPrefectures) => {
    if (!titleTyped) state.setInfo({ ...state.info, title: provisionalTripTitle(picked) })
    next()
  }

  const next = () => {
    if (!canGoNext(step, answers) || index >= steps.length - 1) return
    prepareSounds()
    playSound('switch')
    // 帰る日を押さずに進んだら、日帰り
    if (step === 'date') setAwaitingEnd(false)
    if (step === 'origin') void locateOrigin({ quiet: true })
    setIndex(index + 1)
  }
  const back = () => {
    if (index === 0) return
    playSound('close')
    asked.current += 1
    setThinking(false)
    setIndex(index - 1)
  }

  return {
    step,
    number: index + 1,
    total: steps.length,
    /** 次の問い（最後の問いなら null） */
    upcoming: steps[index + 1] ?? null,
    thinking,
    answers,
    reaction:
      (step === 'origin' && finding && finding.name === state.info.origin.trim() ? originFindingReaction(finding.status, finding.name) : null) ??
      quizReaction(step, answers),
    ready: canGoNext(step, answers),
    pickDate,
    pickMode,
    setInfo,
    setOrigin,
    locateOrigin,
    setGoal,
    setTitle,
    askGemini,
    toTitle,
    next,
    back,
  }
}

export type TripQuiz = ReturnType<typeof useTripQuiz>
