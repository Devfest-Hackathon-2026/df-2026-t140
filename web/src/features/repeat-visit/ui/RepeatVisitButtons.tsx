import { Icon } from '@/shared/ui'
import { useRepeatVisit } from '../model/useRepeatVisit'
import styles from './RepeatVisitButtons.module.css'

interface Props {
  tripId: string
  routeId: string
  /** しおりの行の ID（entities/route の stopIdOf） */
  stopId: string
  /** 場所の名前（読み上げに使う） */
  name: string
  /** 同じ場所の行がほかにもあるか。あるときだけ、行を消すボタンを出す */
  repeated: boolean
}

/**
 * しおり（S11）の場所の行の下（次の場所までの移動の行の右）に置く、行の複製ボタン。押すと、すぐ下に同じ場所の行が増える（亀井の案。#528）。
 * 増えた行を長押しで取って動かせば、同じ場所を旅の中で何度も訪れられる（スキー場に 2 日続けて行く、宿に毎晩戻る、など）。
 * 同じ場所の行が 2 つ以上あるときは、その行だけを消すボタンも出す（建物は消えない）
 */
export function RepeatVisitButtons({ tripId, routeId, stopId, name, repeated }: Props) {
  const { add, remove, busy } = useRepeatVisit(tripId, routeId, stopId)
  return (
    <>
      {repeated && (
        <button type="button" className={styles.button} aria-label={translate(`${name}のこの行を消す`, `Remove this stop at ${name}`)} disabled={busy} onClick={remove}>
          <Icon name="minus" size={18} />
        </button>
      )}
      <button type="button" className={styles.button} aria-label={translate(`${name}をもう 1 回しおりに入れる`, `Add another stop at ${name}`)} disabled={busy} onClick={add}>
        <Icon name="copy" size={18} />
      </button>
    </>
  )
}
import { translate } from '@/shared/lib'
