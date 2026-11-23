import { pinDisplayName } from '@/entities/pin'
import { translate } from '@/shared/lib'
import { Avatar, type Member } from '@/entities/member'
import { type ModelJson, ModelSprite } from '@/entities/model3d'
import type { Pin } from '@/entities/pin'
import { Icon } from '@/shared/ui'
import { badgeOffset, buildingLabelTop, doneLeft } from '../lib/declutter'
import styles from './MapBuilding.module.css'

type Person = Pick<Member, 'displayName' | 'color'>

interface SiteProps {
  pin: Pin
  /** 「建築する！」を押した人 */
  builder: Person | undefined
  /** 名札を省く（まわりと重なって、広げても置けないとき。lib/declutter.ts） */
  labelHidden?: boolean
}

/** 工事中の場所。建築ができあがるまで、全員の地図に出る。待ち画面は出さない */
export function MapBuildingSite({ pin, builder, labelHidden = false }: SiteProps) {
  return (
    <>
      <span className={styles.site} role="img" aria-label={translate(`${pinDisplayName(pin)}（建築中）`, `Building ${pinDisplayName(pin)}`)}>
        <span className={styles.siteRing} />
        <span className={styles.siteIcon}>
          <Icon name="hammer" size={22} />
        </span>
      </span>
      {!labelHidden && (
        <span className={`${styles.label} ${styles.labelBuilding}`}>
          <span className={styles.name}>{pinDisplayName(pin)}</span>
          <span className={styles.state}>{translate('建築中', "Building")}</span>
          {builder && <Avatar member={builder} size={18} />}
        </span>
      )}
    </>
  )
}

interface BuiltProps {
  pin: Pin
  /** 希望を書いた人（誰の希望から建った建物か） */
  wisher: Person | undefined
  /**
   * 絵にして置く模型。面が 3D で描くとき（本物のベクター地図）は null（面が同じ場所に描く）。
   * まだ読めていないときも null
   */
  sprite: ModelJson | null
  /** 絵の大きさ（px） */
  size: number
  selected: boolean
  /** いま建ったばかり。青い輪郭線と「建築完了」の印を出す（S07） */
  celebrating: boolean
  /** ルートで何番目に回るか（1 から）。名札に番号を出す。ルートを出していないときは undefined */
  order?: number
  /** 名札を省く（まわりの名札や建物とぶつかるとき。lib/declutter.ts） */
  labelHidden?: boolean
  /** 近くの建物をまとめて、この建物が代表しているとき、その数（自分を含む）。右上に出す */
  count?: number
  onSelect: () => void
}

/** 押せる範囲の最小の幅と高さ（px）。建物を小さく描いても、指で押せるようにする */
const MIN_TAP = 32

/** 建った建物。押すと場所カードが出る。名札に、場所の名前と、誰の希望かを出す */
export function MapBuilding({ pin, wisher, sprite, size, selected, celebrating, order, labelHidden = false, count = 1, onSelect }: BuiltProps) {
  const who = wisher ? translate(`${wisher.displayName}の希望`, `${wisher.displayName}'s wish`) : translate('希望', "Wish")
  const badge = badgeOffset(size)
  return (
    <>
      {/*
        選んでいる建物（オレンジ）と建ったばかりの建物（青）は、楕円ではなく建物の輪郭線で示す
        （絵なら .spriteSelected と .spriteCelebrating、3D なら lib/buildingsOverlay）。選んでいるときはオレンジだけ
      */}
      <button
        type="button"
        className={styles.building}
        style={{ width: Math.max(size * 0.72, MIN_TAP), height: Math.max(size * 0.62, MIN_TAP) }}
        aria-label={translate(`${pinDisplayName(pin)}（${who}から建った建物${order ? `、${order} 番目` : ''}${count > 1 ? `。近くの ${count - 1} か所もこの建物にまとめて表示しています` : ''}）`, `${pinDisplayName(pin)}, built from ${who}${order ? `, stop ${order}` : ''}${count > 1 ? `. Includes ${count - 1} nearby places` : ''}`)}
        aria-pressed={selected}
        onClick={onSelect}
      >
        {sprite && (
          <span className={selected ? `${styles.sprite} ${styles.spriteSelected}` : celebrating ? `${styles.sprite} ${styles.spriteCelebrating}` : styles.sprite}>
            <ModelSprite model={sprite} size={size} anchored />
          </span>
        )}
      </button>
      {count > 1 && (
        <span className={styles.count} style={{ left: badge.x, top: badge.y }} aria-hidden="true">
          {count}
        </span>
      )}
      {celebrating && (
        // 建ったばかりの状態の印（S07）。押せないので、ボタンの形にせず、役割もフォーカスも付けない（#225）
        <span className={styles.done} style={{ left: doneLeft(size, count), top: -size * 0.62 }}>
          <span className={styles.doneMark} aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
          {translate('建築完了', "Build complete")}
        </span>
      )}
      {!labelHidden && (
        <span className={selected ? `${styles.label} ${styles.labelSelected}` : styles.label} style={{ top: buildingLabelTop(size) }}>
          {order !== undefined && <span className={styles.order}>{order}</span>}
          <span className={styles.name}>{pinDisplayName(pin)}</span>
          {wisher && !selected && <Avatar member={wisher} size={18} />}
        </span>
      )}
    </>
  )
}
