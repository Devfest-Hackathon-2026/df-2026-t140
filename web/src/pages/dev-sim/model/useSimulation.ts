import { type RefObject, useCallback, useRef, useState } from 'react'
import { isLocal } from '@/shared/api'
import { type Frame, MEMBERS, type Pace, type RunState, Runner, STEPS } from './runner'

export const FRAME_WIDTH = 390
export const FRAME_HEIGHT = 844
/** iframe の name。shared/lib/simFrame.ts が読む */
export const frameName = (id: string) => `konbu-sim-${id}`

const INITIAL: RunState = { status: 'idle', stepIndex: -1, caption: '', error: null }

/** 画面ごとに覚える値（地図の設定）を置く。既定は 3 つとも地図なし。?map=on のときは a だけ本物の地図 */
function prepareStorage(realMapOnA: boolean): void {
  for (const member of MEMBERS) {
    const prefix = `sim-${member.id}:`
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
    localStorage.setItem(`${prefix}map`, realMapOnA && member.id === 'a' ? 'on' : 'off')
  }
}

/** 3 つの画面と台本の進み具合。Emulator につないだ開発サーバーでだけ動く */
export function useSimulation(refs: Record<string, RefObject<HTMLIFrameElement | null>>) {
  const [state, setState] = useState<RunState>(INITIAL)
  const [pace, setPaceState] = useState<Pace>('normal')
  const realMapOnA = new URLSearchParams(location.search).get('map') === 'on'
  // 画面（iframe）は、置き場を用意してから読み込む。「最初から」で世代を進めて、読み込み直す
  const [generation, setGeneration] = useState(() => {
    prepareStorage(realMapOnA)
    return 1
  })
  const runner = useRef<Runner | null>(null)

  const frames = useCallback(
    (): Frame[] =>
      MEMBERS.map((member) => ({
        id: member.id,
        name: member.name,
        getWindow: () => refs[member.id].current?.contentWindow ?? null,
        // 人が URL を開くのと同じ（その画面の読み込み直し）
        open: (path) => refs[member.id].current?.contentWindow?.location.assign(path),
      })),
    [refs],
  )

  const begin = useCallback(
    (oneStep: boolean) => {
      runner.current?.abort()
      const next = new Runner(frames(), pace)
      runner.current = next
      next.subscribe(setState)
      // 「1 つ進める」で始めたら、最初の段だけ進めて止まる
      if (oneStep) next.step()
      void next.run()
    },
    [frames, pace],
  )
  const start = useCallback(() => begin(false), [begin])

  const restart = useCallback(() => {
    runner.current?.abort()
    runner.current = null
    prepareStorage(realMapOnA)
    setState(INITIAL)
    // 世代を進めると、3 つの画面（iframe）が作り直されて、ホームから始まる
    setGeneration((value) => value + 1)
  }, [realMapOnA])

  const setPace = useCallback((value: Pace) => {
    setPaceState(value)
    runner.current?.setPace(value)
  }, [])

  return {
    available: isLocal,
    state,
    pace,
    generation,
    realMapOnA,
    steps: STEPS,
    members: MEMBERS,
    start,
    pause: () => runner.current?.pause(),
    resume: () => runner.current?.resume(),
    step: () => (runner.current && state.status !== 'idle' ? runner.current.step() : begin(true)),
    restart,
    setPace,
  }
}
