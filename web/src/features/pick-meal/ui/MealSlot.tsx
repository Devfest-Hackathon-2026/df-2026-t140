import { type FormEvent, useState } from 'react'
import { MEAL_LABELS, MEAL_NOTE_MAX, mealDayLabel, type MealKind, type MealState } from '@/entities/route'
import { CategoryIcon } from '@/entities/pin'
import { playSound, translate } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import styles from './MealSlot.module.css'

/** お店で食べないときの、よくある食べ方。押すと入力欄に入る（書き換えられる）。どのごはんも「なし」を先頭に置く */
const NOTE_EXAMPLES: Record<MealKind, readonly string[]> = translate<Record<MealKind, readonly string[]>>(
  {
    breakfast: ['なし', '宿の朝食', 'コンビニ', '家で食べる'],
    lunch: ['なし', 'お弁当', 'コンビニ', '食べ歩き'],
    dinner: ['なし', '宿の夕食', 'コンビニ', '家で食べる'],
  },
  {
    breakfast: ['None', 'Breakfast at the inn', 'Convenience store', 'Eat at home'],
    lunch: ['None', 'Packed lunch', 'Convenience store', 'Street food'],
    dinner: ['None', 'Dinner at the inn', 'Convenience store', 'Eat at home'],
  },
)

/** 何も書かずに決めたときに出す言葉 */
const NONE = translate('なし', 'None')

interface Props {
  /** どの枠か。お店が建物で決まっている枠は、しおりの行として出るので、ここには渡さない */
  slot: Exclude<MealState, { state: 'pin' }>
  /** 「お店を探す」を押した（すぐ探しはじめ、みんなの地図に戻る） */
  onFind: () => void
  /** お店を建てずに決める（skip が true。note は書いた言葉）か、空の枠に戻す（false）。保存できたら true を返す */
  onSkip: (skip: boolean, note?: string) => Promise<boolean>
  /** お店さがしを頼んでいる途中（「お店を探す」を押せなくする） */
  finding?: boolean
  /** 保存を待っている（どのボタンも押せなくする） */
  saving?: boolean
  /** 旅程が確定している（ボタンを出さない。枠は読むだけ） */
  locked?: boolean
}

/**
 * しおりのごはんの枠（企画書「ユーザー体験」3-7 の 8）。日ごとに朝・昼・晩を、その時間ごろの行のあいだに出す。
 * 見た目と操作は宿の枠（features/pick-lodging の LodgingSlot）と同じ。
 * - まだ決まっていない枠は、名前と「＋ 決める」だけの点線の 1 行にたたんでおき、押すと開いて「お店を探す」と「自分で書く」を選べる
 *   （しおりの中の緑の塗りのボタンを「この旅で決まり！」だけにするため。UI/UX レビューの S-1。#708）
 * - 「自分で書く」を押すと、枠がその場で入力欄に変わる。「なし」「コンビニ」などの候補を押すか、自分で書いて決める（何も書かずに決めると「なし」）
 * - 決めた枠は、書いた言葉の出る灰色の行になり、「変える」で書き直すか、空の枠に戻せる
 */
export function MealSlot({ slot, onFind, onSkip, finding, saving, locked }: Props) {
  const label = MEAL_LABELS[slot.meal]
  const dayLabel = mealDayLabel(slot.day, slot.meal)
  const savedNote = slot.state === 'skip' ? (slot.note ?? '') : ''
  const [editing, setEditing] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const [note, setNote] = useState(savedNote)
  const open = () => {
    playSound('select')
    setNote(savedNote)
    setEditing(true)
  }
  const cancel = () => {
    playSound('close')
    setEditing(false)
  }
  const decide = async (event: FormEvent) => {
    event.preventDefault()
    if (await onSkip(true, note)) setEditing(false)
  }
  const clear = async () => {
    if (await onSkip(false)) setEditing(false)
  }

  if (editing && !locked) {
    const fieldId = `meal-note-${slot.key}`
    return (
      <form className={styles.slot} onSubmit={(event) => void decide(event)} aria-label={translate(`${dayLabel}を書く`, `Write your plan for ${dayLabel}`)}>
        <div className={styles.title}>
          <span className={styles.dot} aria-hidden="true">
            <CategoryIcon category="food" size={20} />
          </span>
          <label className={styles.text} htmlFor={fieldId}>
            <span className={styles.name}>{dayLabel}</span>
            <span className={styles.sub}>{translate('お店で食べないときは、ここに書いて決めます', "If you won't eat at a restaurant, write your plan here")}</span>
          </label>
        </div>
        <ul className={styles.examples} aria-label={translate('よくある食べ方', 'Common choices')}>
          {NOTE_EXAMPLES[slot.meal].map((example) => (
            <li key={example}>
              <button type="button" className={example === note ? `${styles.example} ${styles.picked}` : styles.example} onClick={() => { playSound('select'); setNote(example) }}>
                {example}
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.field}>
          <input
            id={fieldId}
            className={styles.input}
            type="text"
            value={note}
            maxLength={MEAL_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            placeholder={translate('例：コンビニ', 'e.g. Convenience store')}
            enterKeyHint="done"
            autoComplete="off"
          />
          <Button type="submit" variant="go" size="small" sound={false} disabled={saving}>
            {translate('決める', 'Save')}
          </Button>
        </div>
        <div className={styles.actions}>
          <Button variant="text" size="small" sound={false} disabled={saving} onClick={cancel}>
            {translate('やめる', 'Cancel')}
          </Button>
          {slot.state === 'skip' && (
            <Button variant="text" size="small" sound={false} disabled={saving} onClick={() => void clear()}>
              {translate('空の枠に戻す', 'Clear')}
            </Button>
          )}
        </div>
      </form>
    )
  }

  if (slot.state === 'skip') {
    return (
      <div className={styles.decided}>
        <span className={`${styles.dot} ${styles.solid}`} aria-hidden="true">
          <CategoryIcon category="food" size={20} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{slot.note ?? NONE}</span>
          <span className={styles.sub}>{label}</span>
        </span>
        {!locked && (
          <Button variant="text" size="small" sound={false} className={styles.change} disabled={saving} onClick={open}>
            {translate('変える', 'Change')}
          </Button>
        )}
      </div>
    )
  }

  // まだ決まっていない枠の、たたんだ形。名前と「＋ 決める」だけの 1 行
  if (!unfolded && !locked) {
    return (
      <section className={`${styles.slot} ${styles.folded}`} aria-label={translate(`${dayLabel}（まだ決まっていません）`, `${dayLabel} (not decided yet)`)}>
        <span className={styles.dot} aria-hidden="true">
          <CategoryIcon category="food" size={20} />
        </span>
        <span className={styles.name}>{label}</span>
        <Button
          variant="dashed"
          size="small"
          sound={false}
          className={styles.unfold}
          aria-label={translate(`${dayLabel}を決める`, `Decide ${dayLabel}`)}
          onClick={() => {
            playSound('select')
            setUnfolded(true)
          }}
        >
          <Icon name="plus" size={18} />
          {translate('決める', 'Decide')}
        </Button>
      </section>
    )
  }

  return (
    <section className={styles.slot} aria-label={translate(`${dayLabel}（まだ決まっていません）`, `${dayLabel} (not decided yet)`)}>
      <p className={styles.title}>
        <span className={styles.dot} aria-hidden="true">
          <CategoryIcon category="food" size={20} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{label}</span>
          <span className={styles.sub}>{translate('まだ決まっていません', 'Not decided yet')}</span>
        </span>
      </p>
      {!locked && (
        <div className={styles.actions}>
          <Button variant="soft" size="small" sound={false} disabled={finding || saving} onClick={onFind}>
            <Icon name="search" size={18} />
            {translate('お店を探す', 'Find a restaurant')}
          </Button>
          <Button variant="soft" size="small" sound={false} disabled={saving} onClick={open}>
            <Icon name="pencil" size={18} />
            {translate('自分で書く', 'Write my own')}
          </Button>
        </div>
      )}
    </section>
  )
}
