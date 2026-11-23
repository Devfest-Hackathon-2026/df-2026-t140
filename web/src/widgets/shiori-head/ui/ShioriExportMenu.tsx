import { useEffect, useRef, useState } from 'react'
import type { LegMode } from '@/entities/route'
import { type ShioriBook, shioriBookPlaceNames } from '@/entities/trip'
import { CalendarExport } from '@/features/export-calendar'
import { ExportShioriPdfItem } from '@/features/export-shiori-pdf'
import { translate, playSound } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import { directionsUrl } from '../lib/directionsUrl'
import styles from './ShioriExportMenu.module.css'

interface Props {
  tripId: string
  /** 書き出すしおりの中身。まだ読めていない、建った場所がないときは undefined */
  book: ShioriBook | undefined
  /** PDF と Google カレンダーも出すか（確定したあとのしおりビューだけ。2026-11-21、#502）。出さなければ Google マップの道順だけ */
  all?: boolean
  /** 行の ID（集合場所は @origin）→ 次の場所までの手段。PDF の移動の行に書く */
  moveModes?: Readonly<Record<string, LegMode>>
}

/**
 * しおりの書き出しのボタン（しおり S11 と、しおりビュー S14 の上の部分の右）。
 * 押すと「Google マップで道順を見る」のメニューを出す。確定したあとのしおりビューでは「PDF で保存」「Google カレンダーに入れる」も出す。
 * Google マップは、集合場所からしおりの順に回る道順を、別のタブで開く（場所の名前を渡すだけで、Maps の内容は取ってこない）。
 * メニューを閉じても項目は描いたままにする（PDF を作っている途中や、カレンダーに入れる画面を消さないため）
 */
export function ShioriExportMenu({ tripId, book, all = false, moveModes }: Props) {
  const mapsUrl = book ? directionsUrl(book.origin, shioriBookPlaceNames(book)) : null
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)

  // メニューの外を押すか Esc で閉じる
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className={styles.root}>
      <Button
        iconOnly
        sound={false}
        aria-label={translate('しおりを書き出す', "Export itinerary")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!book}
        onClick={() => {
          playSound(open ? 'close' : 'open')
          setOpen(!open)
        }}
      >
        <Icon name="share" />
      </Button>
      <div className={open ? `${styles.menu} ${styles.open}` : styles.menu} role="menu" aria-label={translate('書き出し', "Export")}>
        {mapsUrl && (
          <a role="menuitem" className={styles.item} href={mapsUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <Icon name="external" />
            {translate('Google マップで道順を見る', "View directions in Google Maps")}
          </a>
        )}
        {all && (
          <>
            <ExportShioriPdfItem tripId={tripId} book={book} onDone={() => setOpen(false)} itemClassName={styles.item} moveModes={moveModes} />
            <CalendarExport tripId={tripId} book={book} onPicked={() => setOpen(false)} itemClassName={styles.item} />
          </>
        )}
      </div>
    </div>
  )
}
