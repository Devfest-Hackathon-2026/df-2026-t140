import { useRef } from 'react'
import { FRAME_HEIGHT, FRAME_WIDTH, frameName, useSimulation } from '../model/useSimulation'
import styles from './DevSimPage.module.css'

/** 1280×900 に 3 つが収まるように縮める。1 つの画面は 390×844 のまま（中では本物のスマホの幅） */
const SCALE = 0.8

/**
 * 複数人シミュレーション（開発用。/dev/sim）。スマホの大きさの画面を 3 つ並べ、台本で 3 人の操作を進める。
 * 3 つの画面は本物のアプリ（iframe）で、それぞれ別の匿名ユーザー（iframe の name で分ける）。
 * 既定は 3 つとも地図なし。?map=on を付けると、ゆう（左）の画面だけ本物の地図になる（読み込みは 1 回）。
 */
export function DevSimPage() {
  const refs = { a: useRef<HTMLIFrameElement>(null), b: useRef<HTMLIFrameElement>(null), c: useRef<HTMLIFrameElement>(null) }
  const sim = useSimulation(refs)
  const { state } = sim

  if (!sim.available) return <p className={styles.page}>この画面は、Emulator につないだ開発サーバーでだけ開けます。</p>

  const running = state.status === 'running'
  const total = sim.steps.length
  const position = state.stepIndex >= 0 ? `${state.stepIndex + 1} / ${total}` : `0 / ${total}`

  return (
    <div className={styles.page} style={{ '--frame-width': `${FRAME_WIDTH}px`, '--frame-height': `${FRAME_HEIGHT}px`, '--scale': SCALE } as React.CSSProperties}>
      <div className={styles.controls}>
        <button type="button" className={styles.primary} onClick={sim.start} disabled={running || state.status === 'paused'}>
          開始
        </button>
        <button type="button" onClick={state.status === 'paused' ? sim.resume : sim.pause} disabled={state.status !== 'running' && state.status !== 'paused'}>
          {state.status === 'paused' ? '再開' : '一時停止'}
        </button>
        <button type="button" onClick={sim.step} disabled={running}>
          1 つ進める
        </button>
        <button type="button" onClick={sim.restart}>
          最初から
        </button>
        <label>
          <input type="checkbox" checked={sim.pace === 'fast'} onChange={(event) => sim.setPace(event.target.checked ? 'fast' : 'normal')} /> 速く
        </label>
        <span>
          段 {position}　地図：{sim.realMapOnA ? 'ゆうだけ本物（?map=on）' : '3 つとも地図なし（?map=on で、ゆうだけ本物）'}
        </span>
      </div>
      <p className={state.status === 'failed' ? `${styles.caption} ${styles.failed}` : styles.caption} role="status" aria-live="polite">
        {state.status === 'failed' ? state.error : state.caption || '「開始」を押すと、3 人が旅を計画し始めます'}
      </p>
      <div className={styles.frames}>
        {sim.members.map((member) => (
          <div key={member.id} className={styles.frame}>
            <span className={styles.frameName}>{member.name}</span>
            <div className={styles.scaled}>
              {sim.generation > 0 && (
                <iframe
                  key={sim.generation}
                  ref={refs[member.id as 'a' | 'b' | 'c']}
                  name={frameName(member.id)}
                  title={`${member.name}の画面`}
                  className={styles.phone}
                  src="/"
                  width={FRAME_WIDTH}
                  height={FRAME_HEIGHT}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
