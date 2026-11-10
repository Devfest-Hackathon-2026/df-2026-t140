// 台本（config/scenario.json）を、3 つの画面の本物の UI を操作して進める。
// 各段は、本当の状態（要素や文字が出ること）を待つ。時間切れなら止まり、どの段で止まったかを残す。
import scenario from '../config/scenario.json'
import { type Doc, findControl, findControlContaining, findInput, hasLabel, hasText, press, shioriText, typeInto } from './dom'

export type Pace = 'normal' | 'fast'
export type Status = 'idle' | 'running' | 'paused' | 'done' | 'failed'

export interface RunState {
  status: Status
  /** いま進めている（または止まった）段の番号（0 から）。まだなら -1 */
  stepIndex: number
  caption: string
  error: string | null
}

export interface Frame {
  id: string
  name: string
  /** その画面の window。読み込み直すと変わるので、毎回取り直す */
  getWindow: () => Window | null
  /** その画面で URL を開く（人がリンクを開くのと同じ、読み込み直し） */
  open: (path: string) => void
}

export const STEPS = scenario.steps
export const MEMBERS = scenario.members

const PACE_MS: Record<Pace, { between: number; action: number }> = {
  normal: { between: 2600, action: 900 },
  fast: { between: 300, action: 120 },
}

class Aborted extends Error {}

export class Runner {
  private frames: Record<string, Frame>
  private pace: Pace
  private listeners = new Set<(state: RunState) => void>()
  private aborted = false
  private pausedAt: { resolve: () => void } | null = null
  private wantPause = false
  private stepOnce = false
  state: RunState = { status: 'idle', stepIndex: -1, caption: '', error: null }

  constructor(frames: Frame[], pace: Pace) {
    this.frames = Object.fromEntries(frames.map((frame) => [frame.id, frame]))
    this.pace = pace
  }

  subscribe(listener: (state: RunState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setPace(pace: Pace): void {
    this.pace = pace
  }

  private set(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener(this.state))
  }

  pause(): void {
    this.wantPause = true
    if (this.state.status === 'running') this.set({ status: 'paused' })
  }

  resume(): void {
    this.wantPause = false
    this.stepOnce = false
    this.release()
  }

  /** 止めたまま、次の 1 段だけ進める */
  step(): void {
    this.wantPause = true
    this.stepOnce = true
    this.release()
  }

  abort(): void {
    this.aborted = true
    this.release()
  }

  private release(): void {
    const waiting = this.pausedAt
    this.pausedAt = null
    waiting?.resolve()
  }

  private async gate(): Promise<void> {
    if (this.aborted) throw new Aborted()
    if (!this.wantPause || this.stepOnce) {
      this.stepOnce = false
      return
    }
    this.set({ status: 'paused' })
    await new Promise<void>((resolve) => {
      this.pausedAt = { resolve }
    })
    if (this.aborted) throw new Aborted()
    // 「1 つ進める」で起こされたなら、この段だけ進めて、次の段でまた止まる
    this.stepOnce = false
    this.set({ status: 'running' })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private doc(id: string): Doc {
    const doc = this.frames[id].getWindow()?.document
    if (!doc) throw new Error(`画面 ${id} が読み込まれていません`)
    return doc
  }

  /** 条件が満たされるまで待つ。画面の読み込み直しにも耐える */
  private async until<T>(what: string, probe: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
    const limit = Date.now() + timeoutMs
    for (;;) {
      if (this.aborted) throw new Aborted()
      let value: T | null | undefined | false = null
      try {
        value = probe()
      } catch {
        value = null
      }
      if (value) return value
      if (Date.now() > limit) throw new Error(`${what} を ${Math.round(timeoutMs / 1000)} 秒待ちましたが、出ませんでした`)
      await this.sleep(200)
    }
  }

  private async act(): Promise<void> {
    await this.sleep(PACE_MS[this.pace].action)
  }

  private async pressControl(id: string, name: string, exact = true, timeoutMs?: number): Promise<void> {
    const button = await this.until(`${this.frames[id].name}の画面の「${name}」`, () => findControl(this.doc(id), name, exact), timeoutMs)
    await this.act()
    press(button)
  }

  private async fill(id: string, label: string, value: string): Promise<void> {
    const input = await this.until(`${this.frames[id].name}の画面の入力欄「${label}」`, () => findInput(this.doc(id), label))
    typeInto(input, value)
    await this.act()
  }

  private tripPath(): string {
    const pathname = this.frames.a.getWindow()?.location.pathname ?? ''
    const match = /^\/t\/[^/]+/.exec(pathname)
    if (!match) throw new Error(`旅の URL が分かりません（${pathname}）`)
    return match[0]
  }

  private async buildPlace(id: string, placeName: string): Promise<void> {
    await this.pressControl(id, placeName, false)
    await this.pressControl(id, '建築する！')
    // 建った建物は、地図に「〜から建った建物」として出る（固定の応答で 4 秒ほど）
    await this.until(`${placeName}の完成`, () => findControl(this.doc(id), `${placeName}（`, false)?.getAttribute('aria-label')?.includes('建った建物'), 60_000)
  }

  private async runStep(stepId: string): Promise<void> {
    const { trip, wishes, addedPlace } = scenario
    const wishOf = (by: string) => wishes.find((wish) => wish.by === by)!
    switch (stepId) {
      case 'create': {
        this.frames.a.open('/new')
        await this.fill('a', '旅のタイトル', trip.title)
        await this.fill('a', '開始日', trip.startDate)
        await this.fill('a', '終了日', trip.endDate)
        await this.fill('a', '出発地', trip.origin)
        await this.fill('a', 'あなたの名前', MEMBERS[0].name)
        await this.pressControl('a', '旅を計画する')
        await this.until('招待のシート', () => findControl(this.doc('a'), '閉じる'))
        return
      }
      case 'invite':
        await this.pressControl('a', '閉じる')
        await this.until('やりたいことを書く欄', () => findInput(this.doc('a'), 'この旅でやりたいこと'))
        return
      case 'join-b':
      case 'join-c': {
        const id = stepId.slice(-1)
        this.frames[id].open(this.tripPath())
        await this.fill(id, 'あなたの名前', MEMBERS.find((member) => member.id === id)!.name)
        await this.pressControl(id, 'この旅に参加する')
        await this.until('やりたいことを書く欄', () => findInput(this.doc(id), 'この旅でやりたいこと'))
        return
      }
      case 'wish-a':
      case 'wish-b':
      case 'wish-c': {
        const id = stepId.slice(-1)
        const wish = wishOf(id)
        await this.fill(id, 'この旅でやりたいこと', wish.text)
        await this.pressControl(id, 'この範囲でさがす')
        await this.until(`${wish.build}のピン`, () => findControl(this.doc(id), wish.build, false))
        // 候補のピンは、希望を書いた本人の地図にだけ出る。少し待って、ほかの人の地図に出ていないことを確かめる
        await new Promise((resolve) => setTimeout(resolve, 1500))
        for (const other of ['a', 'b', 'c'].filter((item) => item !== id)) {
          if (findControl(this.doc(other), `${wish.build}（`, false)) {
            throw new Error(`${this.frames[other].name}の地図に、${this.frames[id].name}の候補「${wish.build}」が出ています`)
          }
        }
        return
      }
      case 'build-a':
      case 'build-b':
      case 'build-c': {
        const id = stepId.slice(-1)
        await this.buildPlace(id, wishOf(id).build)
        return
      }
      case 'shiori':
        for (const id of ['a', 'b', 'c']) await this.pressControl(id, 'しおりを開く', false)
        for (const id of ['a', 'b', 'c']) {
          await this.until(`${this.frames[id].name}の画面のしおり`, () => wishes.every((wish) => shioriText(this.doc(id)).includes(wish.build)), 40_000)
        }
        return
      case 'place': {
        const name = wishOf('a').build
        const row = await this.until(`しおりの「${name}」の行`, () => findControlContaining(this.doc('a'), name))
        await this.act()
        press(row)
        await this.until(`${name}の情報`, () => hasLabel(this.doc('a'), `${name}の情報`))
        return
      }
      case 'place-back':
        await this.pressControl('a', 'しおり')
        await this.until('しおり', () => shioriText(this.doc('a')).length > 0)
        return
      case 'back-to-map':
        for (const id of ['a', 'b', 'c']) await this.pressControl(id, 'やりたいことを書く画面に戻る')
        for (const id of ['a', 'b', 'c']) await this.until('みんなの地図', () => findInput(this.doc(id), 'この旅でやりたいこと'))
        return
      case 'build-added':
        await this.buildPlace(addedPlace.by, addedPlace.name)
        // 候補のピンは希望を書いた本人にしか見えない。建てたあとは、ほかの 2 人の画面にも「建った！」が出る
        for (const id of ['b', 'c']) await this.until(`${this.frames[id].name}の画面の「建った！」`, () => hasText(this.doc(id), `${addedPlace.name}が建った`), 40_000)
        return
      case 'shiori-added':
        await this.pressControl('a', 'しおりを開く', false)
        await this.until('しおりの別所温泉', () => shioriText(this.doc('a')).includes(addedPlace.name), 40_000)
        return
      default:
        throw new Error(`台本にない段です：${stepId}`)
    }
  }

  async run(): Promise<void> {
    this.set({ status: 'running', stepIndex: -1, caption: '', error: null })
    try {
      for (const [index, step] of STEPS.entries()) {
        await this.gate()
        this.set({ stepIndex: index, caption: step.caption })
        await this.runStep(step.id)
        await this.sleep(PACE_MS[this.pace].between)
      }
      this.set({ status: 'done', caption: '台本の最後まで進みました' })
    } catch (cause) {
      if (cause instanceof Aborted) return
      const step = STEPS[this.state.stepIndex]
      this.set({ status: 'failed', error: `段 ${this.state.stepIndex + 1}（${step?.id ?? '?'}）で止まりました：${(cause as Error).message}` })
    }
  }
}
