import { type CSSProperties, Fragment, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { type ModelJson, ModelSprite } from '@/entities/model3d'
import { CategoryIcon, pinDisplayName, type Pin } from '@/entities/pin'
import { type AirportStop, type DaySlack, type EventIssue, eventIssueOf, type LodgingNight, lodgingStopIds, MEAL_LABELS, type MealState, mealSlotIndex, mealStops, ORIGIN_KEY, type Route, type RouteStop, scheduleByDay, STOP_TIME_TAGS, stopIdOf, type StopTimeSlot, stopLeaveSlot, stopTimeSlots, visitCounts, withOriginStop } from '@/entities/route'
import { originDisplayName } from '@/entities/trip'
import type { Wish } from '@/entities/wish'
import type { WithId } from '@/shared/api'
import { translate, addDays, clockLabel, monthDayLabel } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import { useStopDrag } from '../model/useStopDrag'
import styles from './RouteTimeline.module.css'

interface Props {
  route: Route
  /** 旅の開始日（YYYY-MM-DD）。2 日以上の旅で「2 日目 11/22（日）」と出すのに使う */
  startDate: string
  pins: readonly WithId<Pin>[]
  members: readonly WithId<Member>[]
  wishes: readonly WithId<Wish>[]
  /** いま見ている地点。行を目立たせる */
  activePinId?: string | null
  /**
   * 場所の行を押したとき（場所の情報 S12 を開く）。渡さなければ、行は押せない。
   * 渡るのは行の ID（ふつうはピンの ID。同じ場所を何度も訪れるしおりでは、2 回目からの行は「ピンの ID~番号」。entities/route の stopIdOf）
   */
  onSelectStop?: (stopId: string) => void
  /**
   * 出発地（集合場所）の名前。渡すと、しおりに出発の行がない旅（出発地の位置が分からないとき、Functions は入れない）でも、
   * 1 日目の先頭に集合場所の行を出す（時刻は出さない）。場所の情報で回る並びの先頭と合わせるため（#226）
   */
  origin?: string
  /** 集合場所の行を押したとき（集合場所の情報を開く）。渡さなければ、集合場所の行は押せない */
  onSelectOrigin?: () => void
  /**
   * 場所の行を取り（指は長押し、マウスはドラッグ）、行と行のあいだに落としたとき。取った行を、落とした位置に差し込む（企画書「ユーザー体験」3-6）。
   * 渡るのは、取った行と、取った行が入る位置にいる行の ID。渡さなければ、行は取れない。集合場所の行は取れず、その前にも差し込めない
   */
  onMoveStop?: (fromStopId: string, toStopId: string) => void
  /**
   * 行の下に出す、次の場所までの移動の行（しおりの移動の手段と目安の時間。features/change-leg-mode）。
   * from は区間の出発（行の ID か、出発地の @origin）、to は行き先の行の ID。渡さなければ移動の行は出さない
   */
  renderMove?: (leg: { from: string; to: string; minutes: number }) => ReactNode
  /**
   * 飛行機の区間で乗り降りする空港（entities/route の legAirportStops）。渡すと、移動の行の下に、乗る空港と降りる空港の行を
   * 場所の行と同じ形（丸、時刻、名前）で出す。空港を経由しない区間は null
   */
  airportsOf?: (leg: { from: string; to: string }) => { from: AirportStop; to: AirportStop } | null
  /**
   * 行の時刻の欄（押して直せる時刻。features/edit-stop-time）。渡すと、行の左（丸と時刻）は場所の情報を開く範囲から外し、
   * 地名から右だけを押して開くようにする。渡さなければ、時刻はただの文字で、行のどこを押しても開く
   */
  renderTime?: (slot: StopTimeSlot) => ReactNode
  /**
   * 場所の行の下（次の場所までの移動の行の右）に出すボタン（行の複製と、行を消す。features/repeat-visit）。
   * repeated は、同じ場所の行がほかにもあるか
   */
  renderActions?: (row: { stopId: string; name: string; repeated: boolean }) => ReactNode
  /**
   * 建った場所の模型（ピンの ID ごと）。渡すと、行の丸に場所の種類の絵の代わりに模型の絵を出す（試験的。かめの依頼、2026-11-21）。
   * 模型がまだ読めていない場所は、種類の絵のまま
   */
  models?: Readonly<Record<string, ModelJson>>
  /**
   * 泊まる夜ごとの宿の状態（entities/route の lodgingNights）。渡すと、宿がまだ決まっていない夜と、宿を取らないと決めた夜の枠を、
   * その日の最後の行の下（次の日への移動の行の上）に renderLodging で出す。その日に行がなければ、枠だけの日を足す。
   * 宿が建物で決まっている夜は、しおりの行として出る（枠は出さない）
   */
  lodging?: readonly LodgingNight[]
  /** 宿の枠（features/pick-lodging の LodgingSlot）。渡さなければ枠は出さない */
  renderLodging?: (night: Extract<LodgingNight, { state: 'open' | 'skip' }>) => ReactNode
  /**
   * 朝・昼・晩ごはんの枠（entities/route の mealSlots）。渡すと、まだ決まっていない枠と、お店を建てずに決めた枠を、その日のその時間ごろの行のあいだに
   * renderMeal で出す（朝はその日の最初、昼は 12 時、晩は 18 時より前に着く最後の行のあと。entities/route の mealSlotIndex）。その日に行がなければ、枠だけの日を足す
   */
  meals?: readonly MealState[]
  /** ごはんの枠（features/pick-meal の MealSlot）。渡さなければ枠は出さない */
  renderMeal?: (slot: Exclude<MealState, { state: 'pin' }>) => ReactNode
  /**
   * 日ごとの空いた時間（entities/route の daySlacks。出す日の分だけ）。渡すと、その日の最後の行の下（宿の枠の上）に renderSlack で出す。
   * その日に行がなければ、ゆとりだけの日を足す（#520）
   */
  slacks?: readonly DaySlack[]
  /** ゆとりの行と、空いた時間への提案の欄（features/fill-slack の SlackSlot）。渡さなければ出さない */
  renderSlack?: (slack: DaySlack) => ReactNode
}

/** イベントの行の困りごとの知らせ（entities/route の eventIssueOf） */
const EVENT_ISSUES: Record<EventIssue, string> = {
  day: translate('開催日と違う日に入っています', 'This is on a different day from the event'),
  late: translate('前の予定からだと、開催に間に合いません', 'You will not make it in time from the previous stop'),
  overlap: translate('次の予定と時間が重なっています', 'This overlaps with the next stop'),
}

/**
 * しおり（S11）の行。建った場所が旅の順に並ぶ：時刻、地点、誰のやりたいことか。
 * 丸の色は、その場所を希望した人の色。出発地の行は「集合場所」。
 * 時刻は、直線距離から計算したおおよその目安（Functions の domain/routePlan.ts）。
 * onMoveStop を渡すと、場所の行を取れる（指は長押し、マウスはドラッグ）。取った行の場所はくぼみ、その行につながる線は消える。
 * 取った行はドラッグでき、落とすと差し込まれる位置（行と行のあいだ）に、横の線が出る（ノートブックのセルを動かすときと同じ）。
 * 集合場所の行は、集合時間と出発時間を分けて出す（Takana の依頼、2026-11-19）。renderTime を渡すと、時刻を押して直せる。
 * 場所の行の時刻は、到着と出発の 2 段。行の下には、左に次の場所までの移動の行、右に行のボタン（renderActions。行の複製と、行を消す）が並ぶ。
 * 同じ場所の行が 2 つ以上あるとき（同じ場所を何度も訪れる。#528）は、その場所の行に「2 回目」のように何回目かを出す。
 * 宿に決まった建物の行（route.lodging）は、その日の最後に並び、地名の下に「宿泊」と出し、出発の時刻は翌朝に宿を出る時刻になる。この行は取れない（落とす先にはなる）。
 * 宿がまだ決まっていない夜には、その日の最後に宿の枠を出す（lodging と renderLodging。企画書「ユーザー体験」3-7）。
 * 日ごとの朝・昼・晩ごはんの枠は、その時間ごろの行のあいだに出す（meals と renderMeal。3-7 の 8）。ごはんに決まったお店の行は、地名の下に「昼ごはん」のように出す。
 * 時刻が決まったイベント（ピンの event。#581）の行は、時刻を枠で囲まず（押しても直せない）、取れない（落とす先にはなる）。
 * 地名の下に「開催 19:30〜20:30」と出し、間に合わない・次の予定と重なる・開催日と違う日なら、そのことを赤で出す。
 */
export function RouteTimeline({ route, startDate, pins, members, wishes, activePinId, onSelectStop, origin, onSelectOrigin, onMoveStop, renderMove, airportsOf, renderTime, renderActions, models, lodging, renderLodging, meals, renderMeal, slacks, renderSlack }: Props) {
  const drag = useStopDrag(onMoveStop)
  const { draggingId, overId, after } = drag.view
  // 宿の枠（まだ決まっていない夜と、宿を取らないと決めた夜）。その日に行がなければ、枠だけの日を足す
  const slots = renderLodging ? (lodging ?? []).filter((night) => night.state !== 'pin') : []
  const slotOf = (day: number) => slots.find((night) => night.night === day)
  // ごはんの枠（まだ決まっていない枠と、お店を建てずに決めた枠）。その日に行がなければ、枠だけの日を足す
  const mealShown = renderMeal ? (meals ?? []).filter((slot): slot is Exclude<MealState, { state: 'pin' }> => slot.state !== 'pin') : []
  // ゆとりの行（空いた時間と、そこへの提案）。その日に行がなければ、ゆとりだけの日を足す
  const shownSlacks = renderSlack ? (slacks ?? []) : []
  const slackOf = (day: number) => shownSlacks.find((slack) => slack.day === day)
  const scheduled = scheduleByDay(origin ? withOriginStop(route.schedule, origin) : route.schedule)
  const extraDays = [...slots.map((night) => night.night), ...shownSlacks.map((slack) => slack.day), ...mealShown.map((slot) => slot.day)].filter(
    (day, index, list) => list.indexOf(day) === index && !scheduled.some((item) => item.day === day),
  )
  const days = [...scheduled, ...extraDays.map((day) => ({ day, stops: [] as RouteStop[] }))].sort((left, right) => left.day - right.day)
  const manyDays = days.length > 1 || (lodging?.length ?? 0) > 0
  // 宿に決まった建物の行の ID
  const stayIds = lodgingStopIds(route)
  // ごはんに決まったお店の行（地名の下に「昼ごはん」と出す）
  const mealOfStop = mealStops(route)
  // その日のごはんの枠を、行の何番目のあとに出すか（0 はその日の最初の行の前）
  const mealsAt = (day: number, stops: readonly RouteStop[], at: number) =>
    mealShown.filter((slot) => slot.day === day && mealSlotIndex(stops, slot.meal, stayIds) === at).map((slot) => <Fragment key={slot.key}>{renderMeal?.(slot)}</Fragment>)
  // 行ごとの次の場所（日をまたぐ移動も、前の日の最後の行の下に出す）
  const placeIds = route.schedule.flatMap((stop) => stopIdOf(stop) ?? [])
  const nextPlaceOf = (stop: RouteStop) => placeIds[placeIds.indexOf(stopIdOf(stop) ?? '') + 1]
  // 同じ場所の行の数と、その行が何回目か（同じ場所を何度も訪れるしおり）
  const counts = visitCounts(route.schedule)
  const places = route.schedule.filter((stop) => stop.pinId)
  const visitNumber = (stop: RouteStop) => places.slice(0, places.indexOf(stop) + 1).filter((item) => item.pinId === stop.pinId).length
  return (
    <div className={draggingId ? `${styles.timeline} ${styles.dragging}` : styles.timeline} onClickCapture={drag.onClickCapture}>
      {days.map(({ day, stops }) => (
        <section key={day} className={styles.day} aria-label={translate(`${day} 日目`, `Day ${day}`)}>
          {manyDays && (
            <h3 className={styles.dayTitle}>
              {translate(`${day} 日目`, `Day ${day}`)}<span className={styles.date}>{monthDayLabel(addDays(startDate, day - 1))}</span>
            </h3>
          )}
          {/* その日の最初の行より前のごはんの枠（朝ごはん。行のない日は、朝・昼・晩とも） */}
          {!draggingId && mealsAt(day, stops, 0)}
          {/* 行のない日の、ゆとりと宿の枠 */}
          {stops.length === 0 && slackOf(day) && renderSlack?.(slackOf(day)!)}
          {stops.length === 0 && slotOf(day) && renderLodging?.(slotOf(day)!)}
          <ol className={styles.stops}>
            {stops.map((stop, index) => {
              // この日の最後の行の下に出す、宿の枠
              const slot = index === stops.length - 1 ? slotOf(day) : undefined
              // この日の最後の行の下に出す、ゆとり（宿の枠より上）
              const slack = index === stops.length - 1 ? slackOf(day) : undefined
              const pin = pins.find((item) => item.id === stop.pinId)
              const stopId = stopIdOf(stop)
              // 宿に決まった建物の行。その日の最後のまま動かさない
              const isStay = stopId !== null && stayIds.includes(stopId)
              // 時刻が決まったイベントの行。時刻は直せず、行は取れない
              const event = pin?.event
              const eventIssue = event ? eventIssueOf(route.schedule, stop, event, startDate) : null
              const repeated = (counts.get(stop.pinId ?? '') ?? 0) > 1
              const wisher = pin ? members.find((member) => member.id === pin.uid) : undefined
              const wish = pin ? wishes.find((item) => item.id === pin.wishId) : undefined
              const active = Boolean(stop.pinId) && stop.pinId === activePinId
              const dotStyle = { '--dot-color': wisher?.color ?? 'var(--color-text-sub)' } as CSSProperties
              // 場所を出る時刻（着く時刻＋滞在）。行を取って動かしている間は出さない（移動の行と同じ）
              const leave = draggingId ? null : stopLeaveSlot(stop)
              // 時刻の欄。集合場所の行は「集合」「出発」、場所の行は「到着」「出発」の 2 段。時刻のない集合場所の行は空けておく
              const times = (
                <span className={styles.times}>
                  {/* 場所の行は、到着の下に出る時刻（着く時刻＋いる時間）。出る時刻も押して直せ、直すといる時間が変わる（かめの決定、2026-11-21、#566） */}
                  {/* 宿の行の出発は翌朝に宿を出る時刻で、直せない（同じ形の枠だけ出す） */}
                  {[...stopTimeSlots(stop), ...(leave ? [leave] : [])].map((slot) => (
                    <span key={slot.key} className={styles.slot}>
                      {STOP_TIME_TAGS[slot.kind] && <span className={styles.tag}>{STOP_TIME_TAGS[slot.kind]}</span>}
                      {event ? (
                        <time className={styles.fixedTime}>{slot.time}</time>
                      ) : renderTime && !(isStay && slot.kind === 'leave') ? (
                        renderTime(slot)
                      ) : (
                        <time className={renderTime ? styles.leaveBox : styles.time}>{slot.time}</time>
                      )}
                    </span>
                  ))}
                </span>
              )
              const lead = (
                <>
                  <span
                    className={pin ? (pin && models?.[pin.id] ? `${styles.dot} ${styles.modelDot}` : styles.dot) : `${styles.dot} ${styles.origin}`}
                    style={pin ? dotStyle : undefined}
                  >
                    {pin ? (
                      models?.[pin.id] ? (
                        <ModelSprite model={models[pin.id]} size={60} className={styles.modelSprite} />
                      ) : (
                        <CategoryIcon category={pin.category} size={20} />
                      )
                    ) : (
                      <Icon name="train" size={20} />
                    )}
                  </span>
                  {times}
                </>
              )
              const text = (
                <>
                  <span className={styles.text}>
                    <span className={styles.name}>{pin ? pinDisplayName({ name: stop.name, nameEn: pin.nameEn }) : originDisplayName(stop.name.replace(/ 出発$/, ''))}</span>
                    {pin ? (
                      (wisher || wish || repeated || isStay || event || (stopId !== null && mealOfStop.has(stopId))) && (
                        <span className={styles.sub}>
                          {/* 宿に決まった建物の行。下の「出発」は、翌朝に宿を出る時刻 */}
                          {isStay && <span className={styles.stayTag}>{translate('宿泊', 'Overnight')}</span>}
                          {/* ごはんに決まったお店の行 */}
                          {stopId !== null && mealOfStop.has(stopId) && <span className={styles.stayTag}>{MEAL_LABELS[mealOfStop.get(stopId)!]}</span>}
                          {event && <span className={styles.eventTag}>{translate('開催 ', 'Event ')}{clockLabel(event.start)}{translate('〜', '–')}{clockLabel(event.end)}</span>}
                          {repeated && <span className={styles.nth}>{translate(`${visitNumber(stop)} 回目`, `Visit ${visitNumber(stop)}`)}</span>}
                          {wisher && <Avatar member={wisher} size={18} />}
                          {wish && <span className={styles.wish}>{translate(`「${wish.text}」`, `“${wish.text}”`)}</span>}
                        </span>
                      )
                    ) : (
                      <span className={styles.sub}>{translate('集合場所', "Meeting point")}</span>
                    )}
                    {eventIssue && <span className={styles.eventIssue}>{EVENT_ISSUES[eventIssue]}</span>}
                  </span>
                  {((pin && onSelectStop) || (!pin && onSelectOrigin)) && (
                    <span className={styles.chevron}>
                      <Icon name="chevron" size={20} />
                    </span>
                  )}
                </>
              )
              // 次の場所までの区間（移動の行と空港の行に使う）。次の場所がない行と、移動のない行は null
              const nextId = stop.moveMinutesToNext !== null ? (stopId ? nextPlaceOf(stop) : placeIds[0]) : undefined
              const leg = nextId && stop.moveMinutesToNext !== null ? { from: stopId ?? ORIGIN_KEY, to: nextId, minutes: stop.moveMinutesToNext } : null
              const airports = leg && airportsOf ? airportsOf(leg) : null
              const lifted = stopId !== null && stopId === draggingId
              // 取った行につながる線（この行から下へ、上の行からこの行へ）は消す
              const lineHidden = lifted || (draggingId !== null && stops[index + 1] !== undefined && stopIdOf(stops[index + 1]) === draggingId)
              // いま落とすと、この行の上（after が false）か下に差し込まれる。その位置に線を出す
              const insertHere = draggingId !== null && stopId !== null && stopId === overId
              const className = [
                styles.stop,
                active && styles.active,
                drag.enabled && stopId && !isStay && !event && styles.grabbable,
                lifted && styles.floating,
                lifted && drag.view.returning && styles.returning,
                lifted && overId !== null && styles.overTarget,
              ]
                .filter(Boolean)
                .join(' ')
              const liftStyle = lifted ? ({ '--drag-x': `${drag.view.x}px`, '--drag-y': `${drag.view.y}px` } as CSSProperties) : undefined
              const select = stopId ? onSelectStop && (() => onSelectStop(stopId)) : onSelectOrigin
              // 場所の行だけを取れるようにする（長押し）。長押しのメニューは出さない
              const grab =
                drag.enabled && stopId && !isStay && !event
                  ? {
                      onPointerDown: (event: PointerEvent<HTMLElement>) => drag.onPointerDown(stopId, event),
                      onContextMenu: (event: MouseEvent) => event.preventDefault(),
                    }
                  : {}
              // 行のボタン（行の複製、行を消す）と、この行のあとに続く枠（ごはん・ゆとり・宿）
              const actions =
                renderActions && stopId ? (
                  <span className={styles.actions}>{renderActions({ stopId, name: pin ? pinDisplayName({ name: stop.name, nameEn: pin.nameEn }) : stop.name, repeated })}</span>
                ) : null
              const rowMeals = mealsAt(day, stops, index + 1)
              const hasFrames = rowMeals.length > 0 || Boolean(slack && renderSlack) || Boolean(slot && renderLodging)
              const itemClass = [styles.item, lifted && styles.hollow, lineHidden && styles.lineHidden, insertHere && (after ? styles.insertAfter : styles.insertBefore)]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={`${stopId ?? 'origin'}-${index}`} className={itemClass} ref={stopId ? drag.rowRef(stopId) : undefined}>
                  {renderTime ? (
                    // 時刻を直せるときは、丸と時刻を押す範囲から外し、地名から右だけを押して開く
                    <div className={`${className} ${styles.split}`} style={liftStyle} {...grab}>
                      <span className={styles.lead}>{lead}</span>
                      {select ? (
                        <button type="button" className={styles.open} aria-current={active ? 'step' : undefined} onClick={select}>
                          {text}
                        </button>
                      ) : (
                        <span className={styles.open}>{text}</span>
                      )}
                    </div>
                  ) : select ? (
                    <button type="button" className={className} style={liftStyle} aria-current={active ? 'step' : undefined} onClick={select} {...grab}>
                      {lead}
                      {text}
                    </button>
                  ) : (
                    <div className={className} style={liftStyle} {...grab}>
                      {lead}
                      {text}
                    </div>
                  )}
                  {/* 行のボタンは、ごはん・ゆとり・宿の枠が続くときは枠より上（行のすぐ下）に出す。枠の下だと、どの行のボタンか分からない */}
                  {!draggingId && actions && hasFrames && (
                    <div className={styles.below}>
                      <span />
                      {actions}
                    </div>
                  )}
                  {/* この行のあとのごはんの枠（その時間ごろの昼・晩ごはん） */}
                  {!draggingId && rowMeals}
                  {slack && !draggingId && renderSlack?.(slack)}
                  {slot && !draggingId && renderLodging?.(slot)}
                  {/* 行の下。左に次の場所までの移動の行、右に行の複製と行を消すボタン（地名が欠けないよう、行の中には置かない）。行を取って動かしている間は出さない */}
                  {!draggingId && ((renderMove && leg) || (actions && !hasFrames)) && (
                    <div className={styles.below}>
                      {renderMove && leg ? (
                        <div className={styles.move}>
                          {renderMove(leg)}
                        </div>
                      ) : (
                        <span />
                      )}
                      {!hasFrames && actions}
                    </div>
                  )}
                  {/* 飛行機の区間で乗り降りする空港。建物と同じ場所の行の形で、乗る空港、降りる空港の順に出す */}
                  {!draggingId && airports && (
                    <>
                      <AirportRow airport={airports.from} tag={translate('出発', 'Dep.')} />
                      <AirportRow airport={airports.to} tag={translate('到着', 'Arr.')} />
                    </>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

/**
 * 飛行機の区間で乗り降りする空港の行。場所の行と同じ形（丸、時刻、名前）で、丸は集合場所と同じ濃い色に飛行機の絵。
 * 時刻は便が決まっていれば出発・到着の時刻、目安の区間では空ける。押せない（空港の情報の画面はない）
 */
function AirportRow({ airport, tag }: { airport: AirportStop; tag: string }) {
  return (
    <div className={`${styles.stop} ${styles.airport}`}>
      <span className={`${styles.dot} ${styles.origin}`}>
        <Icon name="plane" size={20} />
      </span>
      <span className={styles.times}>
        {airport.time && (
          <span className={styles.slot}>
            <span className={styles.tag}>{tag}</span>
            <time className={styles.time}>{airport.time}</time>
          </span>
        )}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{airport.name}</span>
        <span className={styles.sub}>{translate('空港', 'Airport')}</span>
      </span>
    </div>
  )
}
