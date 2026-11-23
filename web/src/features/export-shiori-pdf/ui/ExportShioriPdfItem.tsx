import { translate } from '@/shared/lib'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { CategoryIcon, CATEGORY_LABELS, type PinCategory } from '@/entities/pin'
import type { LegMode } from '@/entities/route'
import type { ShioriBook } from '@/entities/trip'
import { Icon, type IconName } from '@/shared/ui'
import { useExportShioriPdf } from '../model/useExportShioriPdf'
import styles from './ExportShioriPdfItem.module.css'

const CATEGORIES = Object.keys(CATEGORY_LABELS) as PinCategory[]
/** 移動の手段の絵（画面のしおりの移動の行と同じ） */
const MODE_ICONS: Record<LegMode, IconName> = { transit: 'train', car: 'car', walk: 'walk', plane: 'plane' }

interface Props {
  tripId: string
  book: ShioriBook | undefined
  /** PDF を作り終えた（保存した、作れなかった）。メニューを閉じる */
  onDone: () => void
  /** メニューの項目のボタンの見た目（置く側が決める） */
  itemClassName: string
  /** 行の ID（集合場所は @origin）→ 次の場所までの手段。PDF の移動の行に書く */
  moveModes?: Readonly<Record<string, LegMode>>
}

/**
 * 「PDF で保存」。しおりの書き出しのメニューの項目。押すと PDF を作って保存する。
 * PDF の地点の丸に入れるアイコンは、ここで（見えないところに）描いたものを使う
 */
export function ExportShioriPdfItem({ tripId, book, onDone, itemClassName, moveModes }: Props) {
  const icons = useRef<HTMLSpanElement | null>(null)
  const iconMarkup = () => {
    const markup: Record<string, string> = {}
    const serializer = new XMLSerializer()
    icons.current?.querySelectorAll<HTMLElement>('[data-icon]').forEach((element) => {
      const svg = element.querySelector('svg')
      if (svg && element.dataset.icon) markup[element.dataset.icon] = serializer.serializeToString(svg)
    })
    return markup
  }
  const { exportPdf, exporting } = useExportShioriPdf(tripId, book, iconMarkup, moveModes)
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={itemClassName}
        disabled={!book || exporting}
        onClick={() => void exportPdf().then(onDone)}
      >
        {exporting ? <span className={styles.spinner} aria-hidden="true" /> : <Icon name="download" />}
        {exporting ? translate('PDF を作っています…', "Creating PDF…") : translate('PDF で保存', "Save as PDF")}
      </button>
      {/* アイコンの元は、メニュー（role="menu"）の外に置く */}
      {createPortal(
      <span ref={icons} className={styles.iconSource} aria-hidden="true">
        {CATEGORIES.map((category) => (
          <span key={category} data-icon={category}>
            <CategoryIcon category={category} size={24} />
          </span>
        ))}
        <span data-icon="origin">
          <Icon name="train" size={24} />
        </span>
        <span data-icon="other">
          <Icon name="clock" size={24} />
        </span>
        {Object.entries(MODE_ICONS).map(([mode, name]) => (
          <span key={mode} data-icon={`mode-${mode}`}>
            <Icon name={name} size={24} />
          </span>
        ))}
      </span>,
        document.body,
      )}
    </>
  )
}
