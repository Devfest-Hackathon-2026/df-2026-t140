import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type LatLng,
  type PickedPrefectures,
  PREFECTURE_SPECIALTIES,
  REGION_IDS,
  prefectureDisplayName,
  regionDisplayName,
  REGION_PREFECTURES,
  REGION_SPECIALTIES,
  type RegionId,
  RegionShape,
  regionOfPrefecture,
  regionsOfPicked,
  searchAreas,
  setRegionPrefectures,
  togglePrefecture,
  type TravelMode,
  type TripInfo,
} from '@/entities/trip'
import { playSound, type SheetRest, useElementHeight, useSheetDrag, useSheetExpand, translate as t } from '@/shared/lib'
import { Button, Icon, sheetGripClass, sheetGripZoneClass, sheetPeekGripClass } from '@/shared/ui'
import { QUIZ_QUESTIONS } from '../model/tripQuiz'
import { useRegionPicker } from '../model/useRegionPicker'
import styles from './RegionPicker.module.css'
import { SpecialtyIcon } from './SpecialtyIcon'

interface Props {
  /** 旅をつくる入力（タイトル・日程・出発地）。上の帯に出し、出発地には家を立てる */
  info: TripInfo
  /** 開いたときに選んである県 */
  initial: PickedPrefectures
  /** 「つぎへ」を押したとき。選んだ県の名前を渡す（最後の旅の名前の問いへ進む） */
  onNext: (picked: string[]) => void
  /** 戻るボタン。選んだ県の名前を渡す（入力を直して戻ってきても、選んだままにする） */
  onCancel: (picked: string[]) => void
  /** 上の帯（旅をつくる画面と同じ旅の名前の帯）。選んだ県を受け取り、戻るボタンには onBack を使う */
  header: (picked: PickedPrefectures, onBack: () => void) => ReactNode
  /** 何問目か（「しつもん 6 / 6」） */
  number: number
  total: number
  /**
   * 地図に映すもの。地図はページが 1 つだけ持ち（旅をつくる画面の最初の問いから同じ Google マップ）、
   * この画面は選んだ県・サイコロ・出発と、帯とシートの高さを渡す
   */
  onMap: (map: PickerMap) => void
  /** サイコロで選ぶ先をしぼる、出発地の位置と乗り物（model/reach.ts。どちらかが分からなければしぼらない） */
  reach: { from: LatLng | null; mode: TravelMode | null }
}

/** 場所を選ぶ画面から、ページの地図（widgets/trip-map の RegionMap）へ渡すもの */
export interface PickerMap {
  selected: RegionId[]
  pickedPrefectures: string[]
  topInset: number
  bottomInset: number
  dive: boolean
  rolling: RegionId | null
}

/**
 * 大まかな場所（地方と県）を選ぶ画面（旅をつくる、#373。企画書「ユーザー体験」1、案3）。
 * 上の地図（ページが持つ Google マップ。onMap で選んだ県などを渡す）は見るだけで、選んだ県を緑に塗る。下の一覧で、地方をまるごと選ぶか、地方を開いて県を選ぶ。
 * 地方を選ばなくても、県から選べる。場所を知らなくても、名前（漢字か読み）で探せる。
 * 旅をつくる画面の上に、画面いっぱいに重ねて出す。
 * 選ぶと、上の地図が選んだ場所へ寄って少し傾く。「つぎへ」で最後の旅の名前の問いへ進み、そこで「ここへ出発！」を押すと旅を作る
 * （帯とシートが下がり、地図が画面いっぱいに寄って、そのまま旅の地図になる。ui/TripCreatePage。案G）。
 * 下のシートは、しおりと同じく上の取っ手で開け閉めする。押すか下へ引くと、選んだ場所と決めるボタンだけを残して下がり、地図を広く見られる。
 * 上へ引くと、画面の一番上まで広がる（一覧を広く見られる）。広げた形で下へ引くと、元の高さに戻る（しおりと同じ。shared/lib の useSheetExpand）。
 * つかめるのは、取っ手から問いの行まで（サイコロは、押しただけならそのまま押せる）。
 * 上の帯は、旅をつくる画面と同じ旅の名前の帯（header）。問い「どこに行く？」と結果の一言（選ぶと行き先と出発地からの距離）は、シートの上に出す。
 * 問いの右のサイコロを押すと、まだ選んでいない地方から 1 つを選ぶ。選ぶのは、乗り物と日数で行ける範囲の県だけ（model/reach.ts）。
 * 地図には出発地に家を立てる。一覧の地方と県には、形と名物の模型を並べ、選んだ名物は跳ねる（案M）。
 * 選んだ県、サイコロ、帯の中身は model/useRegionPicker.ts が持ち、ここは描くことと、シートの開け閉めの表示だけ
 */
export function RegionPicker({ info, initial, onNext, onCancel, header, number, total, onMap, reach }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  // サイコロで選んだ地方の行が一覧の外にあれば、見えるところまで送る
  const showRow = (id: RegionId) => {
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.setTimeout(() => {
      listRef.current?.querySelector(`[data-region="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: quiet ? 'auto' : 'smooth' })
    }, 40)
  }
  const { picked, all, reaction, rolling, locked, pick, toggleAll, roll, next } = useRegionPicker({
    info,
    initial,
    onNext,
    onLanded: showRow,
    reach,
  })
  const [opened, setOpened] = useState<RegionId[]>([])
  const [query, setQuery] = useState('')
  const [topRef, topHeight] = useElementHeight()
  const [sheetRef, sheetHeight] = useElementHeight()
  const [bodyRef, bodyHeight] = useElementHeight()
  const [collapsed, setCollapsed] = useState(false)
  // 上へ引いて、画面の一番上まで広げた形（オンボーディングは上の帯にも重ねる）。下げたら、広げていない形に戻す
  const expand = useSheetExpand('screen')
  if (collapsed && expand.expanded) expand.reset()
  // 地図に合わせるシートの高さ。広げている間は、広げる前の高さのまま（地図を、見えない範囲に合わせ直さない）
  const [mapSheetHeight, setMapSheetHeight] = useState(sheetHeight)
  // 地図に映すものが変わるたびに、ページの地図へ渡す
  useEffect(() => {
    onMap({ selected: regionsOfPicked(picked), pickedPrefectures: picked, topInset: topHeight, bottomInset: mapSheetHeight, dive: false, rolling })
  }, [onMap, picked, topHeight, mapSheetHeight, rolling])
  // 下げたときに隠す高さ（検索と一覧）。開いているときに測って覚えておく。
  // 一覧は高さ 0 になっても前後のすき間が残るので、すき間は引かない（引くと、そのぶん下のボタンが下がる）
  const [hidden, setHidden] = useState(0)
  const from: SheetRest = collapsed ? 'peek' : 'full'
  const { offset, returning, onReturned, gripProps } = useSheetDrag(
    from,
    0,
    (to) => {
      playSound(to === 'peek' ? 'close' : 'open')
      setCollapsed(to === 'peek')
    },
    // 広げた形で下へ引いている間は、シートの高さを縮めて下げる（いまの高さが、もう下げた高さ）
    collapsed ? {} : expand.expanded ? { shrink: () => expand.steps.shrink?.(0) } : expand.steps,
    // 閉じた形は、取っ手のほかに、シートのボタン以外のところを押しても開く（しおりと同じ）。開いた形では、取っ手のボタンの押下で閉じる
    { tap: collapsed, measureRange: () => hidden, measureGrow: collapsed ? undefined : expand.measureGrow },
  )
  const expanding = expand.active(offset)
  // ドラッグ中と、広げている間は一覧の高さが変わるので測らない
  if (!collapsed && offset === null && !expanding && bodyHeight > 0 && bodyHeight !== hidden) setHidden(bodyHeight)
  if (!expanding && mapSheetHeight !== sheetHeight) setMapSheetHeight(sheetHeight)
  // シートの高さ。開いた高さ（CSS の --sheet-full。広げた形では、その高さ）から、下げた分とドラッグ中のずれを引く
  // （上へ引いている間は、ずれが負なので伸びる）
  const lowered = (collapsed ? hidden : 0) + (offset ?? 0)
  const base = expand.height === null ? 'var(--sheet-full)' : `${expand.height}px`
  const sheetStyle = {
    height: lowered === 0 && expand.height === null ? undefined : `calc(${base} - ${lowered}px)`,
    transition: offset !== null && !returning ? 'none' : undefined,
  } as CSSProperties
  const sheetRefs = (element: HTMLElement | null) => {
    sheetRef(element)
    expand.ref(element)
  }
  const toggleSheet = () => {
    playSound(collapsed ? 'open' : 'close')
    setCollapsed(!collapsed)
  }
  const found = searchAreas(query)
  const searching = query.trim().length > 0
  const regionRow = (id: RegionId) => {
    const name = regionDisplayName(id)
    const inside = REGION_PREFECTURES[id]
    const count = inside.filter((name) => picked.includes(name)).length
    const whole = count === inside.length
    const open = opened.includes(id)
    const several = inside.length > 1
    const shape = <RegionShape id={id} look={whole ? 'picked' : count > 0 ? 'part' : 'none'} size={36} />
    // 選んだ地方の名物は跳ねる（2 つめは少し遅れて）
    const goods = (
      <span className={count > 0 ? `${styles.goods} ${styles.goodsOn}` : styles.goods}>
        {REGION_SPECIALTIES[id].map((name) => (
          <SpecialtyIcon key={name} name={name} className={styles.specialty} />
        ))}
      </span>
    )
    const box = (
      <span className={whole ? `${styles.box} ${styles.boxOn}` : count > 0 ? `${styles.box} ${styles.boxPart}` : styles.box}>
        {whole ? <Icon name="check" size={16} /> : count > 0 ? <Icon name="minus" size={16} /> : null}
      </span>
    )
    const select = () => pick(setRegionPrefectures(picked, id, !whole))
    // 県が 2 つ以上の地方：左の四角を押すと地方をまるごと選び、ほか（名前・数・矢印）を押すと県を開く。
    // 県が 1 つの地方（北海道、沖縄）は開くものがないので、行のどこを押しても選ぶ
    return (
      <li key={id}>
        <div className={rolling === id ? `${styles.row} ${styles.rowRolling}` : count > 0 ? `${styles.row} ${styles.rowOn}` : styles.row} data-region={id}>
          <button
            type="button"
            className={several ? styles.checkBox : styles.check}
            aria-label={name}
            aria-pressed={whole ? true : count > 0 ? 'mixed' : false}
            onClick={select}
          >
            {box}
            {!several && (
              <>
                {shape}
                <span className={styles.name}>{name}</span>
                {goods}
              </>
            )}
          </button>
          {several && (
            <button
              type="button"
              className={styles.open}
              aria-label={open ? t(`${name}の県を閉じる`, `Hide prefectures in ${name}`) : t(`${name}の県を開く`, `Show prefectures in ${name}`)}
              aria-expanded={open}
              onClick={() => {
                playSound('switch')
                setOpened((current) => (open ? current.filter((item) => item !== id) : [...current, id]))
              }}
            >
              {shape}
              <span className={styles.nameBlock}>
                <span className={styles.name}>{name}</span>
                {/* 選んだ県の数は、地方の一部だけを選んだときに出す（まだ選んでいない・まるごと選んだときは要らない） */}
                {count > 0 && !whole && (
                  <span className={styles.count} aria-hidden="true">
                    {count} / {inside.length}
                  </span>
                )}
              </span>
              {goods}
              <span className={open ? `${styles.arrow} ${styles.arrowOpen}` : styles.arrow}>
                <Icon name="chevron" size={18} />
              </span>
            </button>
          )}
        </div>
        {inside.length > 1 && (
          // 県の一覧は閉じていても描いておき、高さを伸び縮みさせて開け閉めする（閉じている間は押せない・読み上げない）
          <div className={open ? `${styles.collapse} ${styles.collapseOpen}` : styles.collapse} inert={!open}>
            <ul className={styles.prefectures}>{inside.map((name) => prefectureRow(name))}</ul>
          </div>
        )}
      </li>
    )
  }
  const prefectureRow = (name: string, withRegion = false) => {
    const on = picked.includes(name)
    const region = regionOfPrefecture(name)
    return (
      <li key={name}>
        <button
          type="button"
          className={[styles.prefecture, withRegion ? styles.prefectureFound : '', on ? styles.prefectureOn : ''].join(' ')}
          aria-pressed={on}
          onClick={() => pick(togglePrefecture(picked, name))}
        >
          <span className={on ? `${styles.box} ${styles.boxOn}` : styles.box}>{on && <Icon name="check" size={16} />}</span>
          <span className={styles.name}>{prefectureDisplayName(name)}</span>
          {withRegion && region && <span className={styles.count}>{regionDisplayName(region)}</span>}
          <span className={on ? `${styles.goods} ${styles.goodsOn}` : styles.goods}>
            <SpecialtyIcon name={PREFECTURE_SPECIALTIES[name]} className={styles.specialty} />
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className={styles.picker} role="dialog" aria-modal="true" aria-label={t('旅する場所をえらぶ', 'Choose where to go')}>
      <div ref={topRef} className={styles.top}>
        {header(picked, () => onCancel(picked))}
      </div>
      <div
        ref={sheetRefs}
        className={collapsed ? `${styles.sheet} ${styles.sheetLowered} ${sheetPeekGripClass}` : styles.sheet}
        style={sheetStyle}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && returning) onReturned()
        }}
        {...(collapsed ? gripProps : {})}
      >
        <button
          type="button"
          className={`${styles.grip} ${collapsed ? '' : sheetGripClass}`}
          aria-label={collapsed ? t('地方の一覧を開く', 'Show regions') : t('地方の一覧を閉じる', 'Hide regions')}
          aria-expanded={!collapsed}
          onClick={toggleSheet}
          {...(collapsed ? {} : gripProps)}
        >
          <span className={styles.handle} aria-hidden="true" />
        </button>
        <div ref={bodyRef} className={styles.body} inert={collapsed}>
          {/* 問いの行も、つかんで上下にドラッグできる（つかめる範囲を広げる。サイコロは、押しただけならそのまま押せる） */}
          <div className={collapsed ? styles.ask : `${styles.ask} ${sheetGripZoneClass}`} {...(collapsed ? {} : gripProps)}>
            <div className={styles.askText}>
              <span className={styles.number}>
                {t('しつもん', 'Question')} {number} / {total}
              </span>
              <h2 className={styles.question}>{QUIZ_QUESTIONS.place}</h2>
              <p className={`${styles.line} ${{ idle: '', picked: styles.linePicked, rolling: styles.lineRolling, landed: styles.lineLanded }[reaction.tone]}`} aria-live="polite">
                {reaction.text}
              </p>
            </div>
            <button
              type="button"
              className={rolling || picked.length > 0 ? styles.dice : `${styles.dice} ${styles.diceIdle}`}
              aria-label={t('サイコロで行き先を決める', 'Roll the dice for a destination')}
              onClick={roll}
            >
              <svg className={rolling ? `${styles.die} ${styles.dieRolling}` : styles.die} width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="var(--color-surface)" />
                <g fill="var(--color-build)">
                  <circle cx="8.3" cy="8.3" r="1.6" />
                  <circle cx="15.7" cy="8.3" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="8.3" cy="15.7" r="1.6" />
                  <circle cx="15.7" cy="15.7" r="1.6" />
                </g>
              </svg>
            </button>
          </div>
          <label className={styles.search}>
            <Icon name="search" size={20} />
            <input
              className={styles.searchInput}
              type="search"
              value={query}
              placeholder={t('県・地方の名前で探す（例：ながの）', 'Search regions or prefectures (e.g. Nagano)')}
              aria-label={t('県・地方の名前で探す', 'Search regions or prefectures')}
              enterKeyHint="search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div ref={listRef} className={styles.list}>
            {searching ? (
              found.regions.length + found.prefectures.length > 0 ? (
                <ul className={styles.rows}>
                  {found.regions.map((id) => regionRow(id))}
                  {found.prefectures.map((name) => prefectureRow(name, true))}
                </ul>
              ) : (
                <p className={styles.empty}>{t('見つかりませんでした', 'No matches')}</p>
              )
            ) : (
              <ul className={styles.rows}>{REGION_IDS.map((id) => regionRow(id))}</ul>
            )}
          </div>
        </div>
        <div className={styles.actions}>
          <Button sound="switch" disabled={locked} onClick={toggleAll}>
            {all ? t('すべて外す', 'Clear all') : t('すべて選ぶ', 'Select all')}
          </Button>
          <Button variant="go" size="large" block sound="switch" disabled={picked.length === 0 || locked} onClick={next}>
            {t('つぎへ', 'Next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
