import { type FormEvent, useState } from 'react'
import { type LodgingNight, LODGING_NOTE_MAX } from '@/entities/route'
import { CategoryIcon } from '@/entities/pin'
import { translate, playSound } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import styles from './LodgingSlot.module.css'

/** 宿を取らない夜の、よくある過ごし方。押すと入力欄に入る（書き換えられる） */
const NOTE_EXAMPLES = [
  translate('車中泊', 'Sleep in the car'),
  translate('夜行バス', 'Overnight bus'),
  translate('友だちの家', 'Stay with a friend'),
  translate('キャンプ', 'Camping'),
] as const

interface Props {
  /** どの夜の枠か。宿が建物で決まっている夜は、しおりの行として出るので、ここには渡さない */
  night: Exclude<LodgingNight, { state: 'pin' }>
  /** 「宿を探す」を押した（すぐ探しはじめ、みんなの地図に戻る） */
  onFind: () => void
  /**
   * 宿を取らない夜にする（skip が true。note は自分で書いた過ごし方）か、空の枠に戻す（false）。保存できたら true を返す
   */
  onSkip: (skip: boolean, note?: string) => Promise<boolean>
  /**
   * 前の夜の宿（建物で決まっているときだけ）。あれば「前の夜と同じ宿にする」を出し、押すと onSame を呼ぶ。
   * 保存できたら true を返す
   */
  previous?: { name: string } | null
  onSame?: () => Promise<boolean>
  /** 宿さがしを頼んでいる途中（「宿を探す」を押せなくする） */
  finding?: boolean
  /** 保存を待っている（どのボタンも押せなくする） */
  saving?: boolean
  /** 旅程が確定している（ボタンを出さない。枠は読むだけ） */
  locked?: boolean
  /**
   * まだ決まっていない夜の枠を開いているか。渡さなければ、枠が自分で持つ（「＋ 決める」を押すと開く）。
   * しおりの一番下の「＋ ○ 日目の宿を決める」から開けるよう、置く側が持つこともできる（UI/UX レビューの S-4。#708）
   */
  unfolded?: boolean
  /** 「＋ 決める」を押した（unfolded を置く側が持つとき） */
  onUnfold?: () => void
}

/**
 * しおりの宿の枠（企画書「ユーザー体験」3-7）。泊まる夜ごとに、その日の最後に出す。
 * - まだ決まっていない夜は、名前と「＋ 決める」だけの点線の 1 行にたたんでおく。しおりの中の緑の塗りのボタンを
 *   「この旅で決まり！」だけにするため（UI/UX レビューの S-1。#708）
 * - 「＋ 決める」を押すと枠が開き、「宿を探す」と「自分で書く」を選べる。前の夜の宿が建物で決まっていれば、「前の夜と同じ宿にする」も選べる
 *   （同じ宿に 2 泊以上する。前の夜の宿の行を複製して、この夜の宿にする）
 * - 「自分で書く」を押すと、枠がその場で入力欄に変わる。車中泊や夜行バスのように、宿を取らない夜の過ごし方を書いて決める
 *   （よくある過ごし方は、上の候補を押すと欄に入る。何も書かずに決めると「宿は取らない」）
 * - 決めた夜は、書いた言葉の出る灰色の行になり、「変える」で書き直すか、空の枠に戻せる
 */
export function LodgingSlot({ night, onFind, onSkip, previous, onSame, finding, saving, locked, unfolded, onUnfold }: Props) {
  const savedNote = night.state === 'skip' ? (night.note ?? '') : ''
  const [editing, setEditing] = useState(false)
  const [ownUnfolded, setOwnUnfolded] = useState(false)
  const isUnfolded = unfolded ?? ownUnfolded
  const unfold = () => {
    playSound('select')
    if (onUnfold) onUnfold()
    else setOwnUnfolded(true)
  }
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
    const fieldId = `lodging-note-${night.night}`
    return (
      <form className={styles.slot} data-lodging-night={night.night} onSubmit={(event) => void decide(event)} aria-label={translate(`${night.night} 日目の夜の過ごし方を書く`, `Write plans for night ${night.night}`)}>
        <div className={styles.title}>
          <span className={styles.dot} aria-hidden="true">
            <CategoryIcon category="lodging" size={20} />
          </span>
          <label className={styles.text} htmlFor={fieldId}>
            <span className={styles.name}>{translate(`${night.night} 日目の夜の過ごし方`, `Plans for night ${night.night}`)}</span>
            <span className={styles.sub}>{translate('宿を取らない夜は、ここに書いて決めます', 'If you won\'t book lodging, write how you\'ll spend the night.')}</span>
          </label>
        </div>
        <ul className={styles.examples} aria-label={translate('よくある過ごし方', 'Example overnight plans')}>
          {NOTE_EXAMPLES.map((example) => (
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
            maxLength={LODGING_NOTE_MAX}
            onChange={(event) => setNote(event.target.value)}
            placeholder={translate('例：車中泊', 'e.g. Sleep in the car')}
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
          {night.state === 'skip' && (
            <Button variant="text" size="small" sound={false} disabled={saving} onClick={() => void clear()}>
              {translate('空の枠に戻す', 'Clear plans')}
            </Button>
          )}
        </div>
      </form>
    )
  }

  if (night.state === 'skip') {
    return (
      <div className={styles.decided}>
        <span className={`${styles.dot} ${styles.solid}`} aria-hidden="true">
          <CategoryIcon category="lodging" size={20} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{night.note ?? translate('宿は取らない', 'No lodging')}</span>
          <span className={styles.sub}>{night.note ? translate(`${night.night} 日目・宿は取らない`, `Night ${night.night} · No lodging`) : translate(`${night.night} 日目の夜`, `Night ${night.night}`)}</span>
        </span>
        {!locked && (
          <Button variant="text" size="small" sound={false} className={styles.change} disabled={saving} onClick={open}>
            {translate('変える', 'Edit')}
          </Button>
        )}
      </div>
    )
  }

  // まだ決まっていない夜の、たたんだ形。名前と「＋ 決める」だけの 1 行
  if (!isUnfolded && !locked) {
    return (
      <section className={`${styles.slot} ${styles.folded}`} data-lodging-night={night.night} aria-label={translate(`${night.night} 日目の宿（まだ決まっていません）`, `Lodging for night ${night.night} (not yet chosen)`)}>
        <span className={styles.dot} aria-hidden="true">
          <CategoryIcon category="lodging" size={20} />
        </span>
        <span className={styles.name}>{translate(`${night.night} 日目の宿`, `Lodging for night ${night.night}`)}</span>
        <Button
          variant="dashed"
          size="small"
          sound={false}
          className={styles.unfold}
          aria-label={translate(`${night.night} 日目の宿を決める`, `Choose lodging for night ${night.night}`)}
          onClick={unfold}
        >
          <Icon name="plus" size={18} />
          {translate('決める', 'Choose')}
        </Button>
      </section>
    )
  }

  return (
    <section className={styles.slot} data-lodging-night={night.night} aria-label={translate(`${night.night} 日目の宿（まだ決まっていません）`, `Lodging for night ${night.night} (not yet chosen)`)}>
      <p className={styles.title}>
        <span className={styles.dot} aria-hidden="true">
          <CategoryIcon category="lodging" size={20} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{translate(`${night.night} 日目の宿`, `Lodging for night ${night.night}`)}</span>
          <span className={styles.sub}>{translate('まだ決まっていません', 'Not yet chosen')}</span>
        </span>
      </p>
      {!locked && (
        <div className={styles.actions}>
          <Button variant="soft" size="small" sound={false} disabled={finding || saving} onClick={onFind}>
            <Icon name="search" size={18} />
            {translate('宿を探す', 'Find lodging')}
          </Button>
          <Button variant="soft" size="small" sound={false} disabled={saving} onClick={open}>
            <Icon name="pencil" size={18} />
            {translate('自分で書く', 'Write a plan')}
          </Button>
          {previous && onSame && (
            <Button
              variant="soft"
              size="small"
              sound={false}
              disabled={saving}
              aria-label={translate(`${night.night} 日目も、${night.night - 1} 日目と同じ${previous.name}に泊まる`, `Stay at ${previous.name} again on day ${night.night}, same as day ${night.night - 1}`)}
              onClick={() => void onSame()}
            >
              <CategoryIcon category="lodging" size={18} />
              {translate('前の夜と同じ宿にする', 'Same as the previous night')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
