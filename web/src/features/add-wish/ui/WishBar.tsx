import { type ReactNode, useMemo } from 'react'
import type { MapBounds } from '@/entities/wish'
import { translate, playSound } from '@/shared/lib'
import { ErrorText, Icon } from '@/shared/ui'
import { useAddWish, WISH_EXAMPLES } from '../model/useAddWish'
import { hintsForArea } from '../model/regionalHints'
import { useRotatingHint } from '../model/useRotatingHint'
import styles from './WishBar.module.css'

interface Props {
  tripId: string
  /** いま地図で映している範囲。場所を書かなければ、この範囲から探す */
  getBounds: () => MapBounds | null
  /** 書けたときに、希望の ID を渡して呼ぶ */
  onAdded: (wishId: string) => void
  /** 欄の上に出す知らせ（旅程に足りないもの。宿の知らせは features/pick-lodging の LodgingHint）。なければ出さない */
  hint?: ReactNode
  /** 地図でいま見ている地域（都道府県か地方の名前。日本全体なら null）。欄が空のときの例文を、この地域のものにする */
  area?: string | null
}

/**
 * やりたいことを書く欄（S04）。誰でも、好きなときに書ける。
 * 「新潟の温泉！」のように場所も書けばそこを、書かなければ、いま地図で見ているあたりから探す。
 */
export function WishBar({ tripId, getBounds, onAdded, hint, area = null }: Props) {
  const { text, setText, problem, sending, submit } = useAddWish(tripId, getBounds, onAdded)
  const hints = useMemo(() => hintsForArea(area), [area])
  const { hint: rotatingHint, shown } = useRotatingHint(text === '', hints)

  return (
    <form className={styles.bar} onSubmit={submit} noValidate>
      {hint}
      <ul className={styles.examples} aria-label={translate('書き出しの例', 'Search examples')}>
        {WISH_EXAMPLES.map((example) => (
          <li key={example.label}>
            <button type="button" className={styles.example} onClick={() => { playSound('select'); setText(example.text) }}>
              {example.label}
            </button>
          </li>
        ))}
      </ul>
      <ErrorText>{problem}</ErrorText>
      {/* 旅を作った直後の案内（pages/trip-map の ShioriCoachMark）が、この印で探して欄と探すボタンの行を指す */}
      <div className={styles.field} data-guide="wish-field">
        <span className={styles.inputBox}>
          <input
            className={styles.input}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label={translate('この旅でやりたいこと', 'What you want to do on this trip')}
            enterKeyHint="search"
            autoComplete="off"
          />
          {/* 欄が空のときの例文。placeholder では消え方を動かせないので、欄の上に重ねる */}
          {text === '' && (
            <span className={styles.hint} data-shown={shown} aria-hidden="true">
              {rotatingHint}
            </span>
          )}
        </span>
        <button type="submit" className={styles.search} aria-label={translate('この範囲でさがす', 'Search this area')} disabled={sending}>
          <Icon name="search" size={26} />
        </button>
      </div>
    </form>
  )
}
