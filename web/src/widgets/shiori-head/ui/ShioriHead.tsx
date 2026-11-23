import { translate } from '@/shared/lib'
import type { ReactNode } from 'react'
import { type ShioriBook, type TravelMode } from '@/entities/trip'
import { TravelModeSwitch } from '@/features/change-travel-mode'
import { ShioriExportMenu } from './ShioriExportMenu'
import styles from './ShioriHead.module.css'

interface Props {
  tripId: string
  /** 日程とメンバーの数の印（HeaderBadge）。置く画面が渡す */
  badges: ReactNode
  /** 書き出すしおりの中身。まだ読めていない、建った場所がないときは undefined（書き出しのボタンは押せない） */
  book: ShioriBook | undefined
  /** 書き出しのボタンの左に置くもの（全面のしおりの再生ボタン）。置く画面が渡す */
  action?: ReactNode
  /** 書き出しに PDF と Google カレンダーも出すか。確定したあとのしおりビュー（S14）だけ。ほかは Google マップの道順だけ */
  allExports?: boolean
}

/**
 * しおりの上の部分（取っ手のすぐ下に残る所）。日程とメンバーの数、右に書き出しのボタン
 * （地図の見えるしおりでは Google マップの道順だけ。確定したあとのしおりビューでは PDF と Google カレンダーも）。
 * おもな移動の切り替え（ShioriMode）は、しおりの行といっしょに上下に送るので、ここには入れない（Takana の依頼、2026-11-22）
 */
export function ShioriHead({ tripId, badges, book, action, allExports = false }: Props) {
  return (
    <div className={styles.head}>
      <div className={styles.chips}>
        <span className={styles.badges}>{badges}</span>
        {action}
        <ShioriExportMenu tripId={tripId} book={book} all={allExports} />
      </div>
    </div>
  )
}

interface ModeProps {
  tripId: string
  /** おもな移動（電車・バス、車、飛行機） */
  mode: TravelMode
  /** 旅程が確定していて、おもな移動を選び直せない（切り替えを出さない） */
  locked?: boolean
  /**
   * 断り書きの下に、駅と線路のデータの出典（RailSource）も出すか。しおりの行があるときは、出典を料金の目安の下へ移すので false にする
   * （UI/UX レビューの S-6。#708）。そのときは置く側が RailSource を出す
   */
  withSource?: boolean
}

/**
 * おもな移動（電車・バス、車、飛行機）の切り替えと、電車・バスの目安の断り書き（飛行機の旅も、空港までと現地は電車・バスで見積もるので出す）。切り替えると、しおりの時刻が組み直される。
 * しおりの行の欄の先頭に置き、行といっしょに上下に送る
 */
export function ShioriMode({ tripId, mode, locked = false, withSource = true }: ModeProps) {
  // 確定していて、断り書きもない（車）ときは、何も出さない
  if (locked && mode === 'car') return null
  return (
    <div className={styles.mode}>
      {/* 旅程が確定しているあいだは選び直せないので、切り替えごと出さない（かめの依頼、2026-11-21）。電車・バスの出典の注記は残す */}
      {!locked && <TravelModeSwitch tripId={tripId} mode={mode} />}
      {mode !== 'car' && (
        <div className={styles.modeNote}>
          <p>{translate('電車・バスの時間は目安です。実際の時間は最新の情報を参照してください', 'Train and bus times are estimates. Check the latest information for actual times.')}</p>
          {withSource && <RailSource mode={mode} />}
        </div>
      )}
    </div>
  )
}

/**
 * 駅と線路のデータ（国土数値情報。CC BY 4.0）の出典の 1 行。電車・バスで見積もる旅（車でない旅）だけに出す。
 * 画面では、しおりのここ（断り書きの下か、料金の目安の下）にしか出していないので、表示はやめない（docs/records/credits.md）
 */
export function RailSource({ mode, className }: { mode: TravelMode; className?: string }) {
  if (mode === 'car') return null
  return (
    <p className={className ? `${styles.source} ${className}` : styles.source}>
      {translate('駅と線路のデータ：「国土数値情報（鉄道データ）」（国土交通省）をもとに加工して作成', "Station and railway data: adapted from Japan's National Land Numerical Information (Railway Data), Ministry of Land, Infrastructure, Transport and Tourism")}
    </p>
  )
}
