import type { MapBounds } from '@/entities/wish'
import { playSound } from '@/shared/lib'
import { ErrorText, Icon } from '@/shared/ui'
import { useAddWish, WISH_EXAMPLES } from '../model/useAddWish'
import styles from './WishBar.module.css'

interface Props {
  tripId: string
  /** いま地図で映している範囲。場所を書かなければ、この範囲から探す */
  getBounds: () => MapBounds | null
  /** 書けたときに、希望の ID を渡して呼ぶ */
  onAdded: (wishId: string) => void
}

/**
 * やりたいことを書く欄（S04）。誰でも、好きなときに書ける。
 * 「新潟の温泉！」のように場所も書けばそこを、書かなければ、いま地図で見ているあたりから探す。
 */
export function WishBar({ tripId, getBounds, onAdded }: Props) {
  const { text, setText, problem, sending, submit } = useAddWish(tripId, getBounds, onAdded)

  return (
    <form className={styles.bar} onSubmit={submit} noValidate>
      <ul className={styles.examples} aria-label="書き出しの例">
        {WISH_EXAMPLES.map((example) => (
          <li key={example.label}>
            <button type="button" className={styles.example} onClick={() => { playSound('select'); setText(example.text) }}>
              {example.label}
            </button>
          </li>
        ))}
      </ul>
      <ErrorText>{problem}</ErrorText>
      <div className={styles.field}>
        <input
          className={styles.input}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="この旅でやりたいことは？"
          aria-label="この旅でやりたいこと"
          enterKeyHint="search"
          autoComplete="off"
        />
        <button type="submit" className={styles.search} aria-label="この範囲でさがす" disabled={sending}>
          <Icon name="search" size={26} />
        </button>
      </div>
    </form>
  )
}
