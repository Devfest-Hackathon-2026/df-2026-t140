import type { CSSProperties, ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Avatar } from '@/entities/member'
import { type ModelJson, ModelSprite } from '@/entities/model3d'
import { CategoryIcon, type PinCategory } from '@/entities/pin'
import { type AirportStop, LEAVE_MARK, lodgingStopIds, MEET_KEY, ORIGIN_KEY, type Route, type StopTimeKind, stopLeaveTime } from '@/entities/route'
import { originDisplayName, type ShioriBook, type ShioriDay } from '@/entities/trip'
import { ShioriCost } from '@/features/shiori-cost'
import { LegMove } from '@/features/change-leg-mode'
import { StopTime } from '@/features/edit-stop-time'
import { UnconfirmShioriButton } from '@/features/confirm-shiori'
import { type ShioriWeatherData, type Sky, WeatherIcon } from '@/features/shiori-weather'
import type { WithId } from '@/shared/api'
import { translate, monthDayLabel } from '@/shared/lib'
import { ButtonLink, ErrorText, Icon, Loading } from '@/shared/ui'
import { ShioriExportMenu } from '@/widgets/shiori-head'
import { type FinalRowView, useFinalShiori } from '../model/useFinalShiori'
import styles from './FinalShioriPage.module.css'

/**
 * 決まったしおり（S14）。発案者が旅程を確定した旅のしおりを、地図なしで画面いっぱいに出す（企画書「ユーザー体験」3-6）。
 * 一番上に戻るボタン（ホームへ）、旅のタイトル、書き出しのボタン（Google マップ、PDF、Google カレンダー）。
 * 確定しているあいだは行程が止まっているので、中身は今のしおりのまま変わらない。発案者だけは、地図のしおり（S11）と同じく、時刻の欄を押して直せる。一番下に、発案者だけ「確定を取り消す」。
 * 「地図で見る」は、下の中央に浮かべ、スクロールしても同じ位置に残す。押すと地図だけの画面（?view=map）へ（Lazyturtle0852 の依頼、2026-11-22。一番下まで行かないと押せなかったため）。
 * 下の端には上が透けるグラデーションの帯を敷き、行の右端の天気の絵とボタンが重ならないようにする（UI/UX レビューの F-1。#708）。
 * 左上のボタンは行き先（ホーム）に合わせて家の形にする（F-3）。
 * 2026-11-18 の #393（Takana）の画面を、2026-11-21 に戻した（かめの決定、#502。シートを広げる形より、決まったしおりらしいため）
 */
export function FinalShioriPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const { loading, failed, title, confirmed, isOwner, book, days, dateText, models, route, trip, pins, weather, moveModes } = useFinalShiori(tripId)
  const mapShiori = `/t/${tripId}?view=shiori`
  // 確定したしおりを地図で見る画面。旅程はこの画面で見ているので、地図と再生ボタンだけにする
  const mapOnly = `/t/${tripId}?view=map`

  if (loading) return <Loading />

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <ButtonLink to="/" sound="close" iconOnly aria-label={translate('ホーム（旅の一覧）へ戻る', "Back to your trips")}>
          {/* 行き先がホームなので、戻る矢印ではなく家の形にする（UI/UX レビューの F-3） */}
          <Icon name="home" />
        </ButtonLink>
        <h1 className={styles.title}>{title}</h1>
        <ShioriExportMenu tripId={tripId} book={confirmed ? book : undefined} all moveModes={moveModes} />
      </header>

      <main className={styles.body}>
        {confirmed && book ? (
          <FinalShioriBook
            tripId={tripId} book={book} days={days} dateText={dateText} models={models} route={route} editable={isOwner} weather={weather}
          />
        ) : (
          <div className={styles.missing}>
            <ErrorText>{failed ? translate('しおりを開けませんでした。電波のよいところで、もう一度開いてください。', "Couldn't open the itinerary. Check your connection and try again.") : translate('この旅のしおりは、まだ決まっていません。', "This itinerary hasn't been finalized yet.")}</ErrorText>
          </div>
        )}
        {confirmed && book && trip && route && <ShioriCost trip={trip} route={route} pins={pins} memberCount={book.members.length} />}
        {confirmed && isOwner && <UnconfirmShioriButton tripId={tripId} onUnconfirmed={() => navigate(mapShiori, { replace: true })} />}
      </main>

      {/*
        下の中央に浮かべ、スクロールしても同じ位置に残す（しおりのどこを見ていても地図へ移れる）。確定していないときは地図のしおりへ。
        下の端の帯（上が透けるグラデーション）に載せ、行の右端の天気の絵とボタンが重ならないようにする（UI/UX レビューの F-1）
      */}
      <div className={styles.floating}>
        <ButtonLink to={confirmed ? mapOnly : mapShiori} variant="route" className={styles.mapButton}>
          <Icon name="map" />
          {translate('地図で見る', 'View on the map')}
        </ButtonLink>
      </div>
    </div>
  )
}

interface BookProps {
  tripId: string
  book: ShioriBook
  days: (Omit<ShioriDay, 'rows'> & { rows: FinalRowView[] })[]
  dateText: string
  models: Record<string, ModelJson>
  route: WithId<Route> | null
  /** 天気予報。場所の行の右端のアイコンに使う（上の一覧は出さない。Takana の依頼、2026-11-23） */
  weather: ShioriWeatherData
  /** 時刻を直せるか（確定しているあいだは発案者だけ。地図のしおりと同じ。かめの依頼、2026-11-21） */
  editable: boolean
}

function FinalShioriBook({ tripId, book, days, dateText, models, route, editable, weather }: BookProps) {
  const manyDays = days.length > 1
  // 次の場所（日をまたいでも、しおりの順で次に建った場所）。移動の行の行き先に使う
  return (
    <>
      <section className={styles.cover} aria-label={translate('旅の情報', "Trip details")}>
        <span className={styles.badge}>
          <Icon name="bookmark" size={16} />
          {translate('決まったしおり', "Final itinerary")}
        </span>
        <p className={styles.info}>
          <Icon name="calendar" size={20} />
          {dateText}
        </p>
        <p className={styles.info}>
          <Icon name="train" size={20} />
          {translate(`集合場所　${book.origin}`, `Meeting point: ${originDisplayName(book.origin)}`)}
        </p>
        <ul className={styles.members} aria-label={translate('メンバー', "Members")}>
          {book.members.map((member, index) => (
            <li key={index} className={styles.member}>
              <Avatar member={{ displayName: member.name, color: member.color }} size={26} />
              {member.name}
            </li>
          ))}
        </ul>
      </section>

      {days.map((day) => (
        <section key={day.day} className={styles.day} aria-label={translate(`${day.day} 日目`, `Day ${day.day}`)}>
          {manyDays && (
            <h2 className={styles.dayTitle}>
              {translate(`${day.day} 日目`, `Day ${day.day}`)}<span className={styles.date}>{monthDayLabel(day.date)}</span>
            </h2>
          )}
          <ol className={styles.rows}>
            {day.rows.map((row, index) => {
              // 地図のしおり（S11）と同じく、場所の行の下に出る時刻、その下に次の場所までの移動の行を出す（かめの依頼、2026-11-21）
              const leg = row.leg
              return (
                <li key={index} className={styles.item}>
                  <Row
                    row={row}
                    model={row.pinId ? models[row.pinId] : undefined}
                    // その日・その府県の天気（着く時刻の 6 時間の区切り）。予報がなければ出さない（Takana の依頼、2026-11-22）
                    sky={row.kind === 'place' ? weather.skyAt(row.pinId, day.date, row.time) : null}
                    // 発案者なら、地図のしおりと同じく、時刻の欄を押して直せる（集合時間、出発時間、場所に着く時刻と出る時刻）
                    renderTime={
                      editable && route
                        ? (kind, key, time) =>
                            // 宿の行の出発は翌朝に宿を出る時刻で、直せない
                            kind === 'leave' && lodgingStopIds(route).includes(key.slice(0, -LEAVE_MARK.length)) ? (
                              <time className={styles.time}>{time}</time>
                            ) : (
                              <StopTime tripId={tripId} routeId={route.id} slot={{ kind, key, time }} />
                            )
                        : undefined
                    }
                  />
                  {leg && route && (
                    <div className={styles.move}>
                      <LegMove
                        tripId={tripId} routeId={route.id} minutes={row.moveMinutesToNext!} locked
                        from={leg.from} to={leg.to} mode={leg.mode} chosen={leg.chosen} tripMode={leg.tripMode}
                        walkable={leg.walkable} planeable={leg.planeable} flight={leg.flight}
                      />
                    </div>
                  )}
                  {/* 飛行機の区間で乗り降りする空港。地図のしおりと同じく、場所の行の形で出す */}
                  {leg?.airports && (
                    <>
                      <AirportRow airport={leg.airports.from} tag={translate('出発', 'Dep.')} />
                      <AirportRow airport={leg.airports.to} tag={translate('到着', 'Arr.')} />
                    </>
                  )}
                </li>
              )
            })}
            {/* 宿を取らない夜は、その日の最後に、書いた過ごし方を出す（地図のしおりの宿の枠と同じ言葉。#553） */}
            {day.nightOff && (
              <li className={styles.item}>
                <NightOffRow name={day.nightOff.name} sub={day.nightOff.sub} />
              </li>
            )}
          </ol>
        </section>
      ))}

      <p className={styles.note}>{translate('時刻と移動の時間は、直線距離から計算したおおよその目安です。', "Times and travel durations are estimates based on straight-line distances.")}</p>
      {/* 天気のアイコンの出どころ（気象庁の予報。出典を書いて使う） */}
      <p className={styles.note}>
        <a href="https://www.jma.go.jp/bosai/forecast/" target="_blank" rel="noreferrer">
          {translate('天気は気象庁の天気予報をもとに作成', 'Weather: Japan Meteorological Agency')}
        </a>
      </p>
    </>
  )
}

type RenderTime = (kind: StopTimeKind, key: string, time: string) => ReactNode

/** 宿を取らない夜の行。name は書いた過ごし方（書いていなければ「宿は取らない」）、sub は書いたときだけ「宿は取らない」 */
function NightOffRow({ name, sub }: { name: string; sub: string | null }) {
  return (
    <div className={`${styles.row} ${styles.minor}`}>
      <span className={styles.minorDot}>
        <CategoryIcon category="lodging" size={16} />
      </span>
      <span className={styles.times} />
      <span className={styles.text}>
        <span className={styles.minorName}>{name}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
    </div>
  )
}

/** 飛行機の区間で乗り降りする空港の行。集合場所と同じ濃い色の丸に飛行機の絵。時刻は便が決まっているときだけ */
function AirportRow({ airport, tag }: { airport: AirportStop; tag: string }) {
  return (
    <div className={styles.row}>
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

function Row({ row, model, sky, renderTime }: { row: FinalRowView; model?: ModelJson; sky: Sky | null; renderTime?: RenderTime }) {
  // 直せるときは枠つきの欄、直せないときは文字だけ
  const clock = (kind: StopTimeKind, key: string, time: string) =>
    renderTime ? renderTime(kind, key, time) : <time className={styles.time}>{time}</time>
  if (row.kind === 'other') {
    return (
      <div className={`${styles.row} ${styles.minor}`}>
        <span className={styles.minorDot}>
          <Icon name="clock" size={16} />
        </span>
        <span className={styles.times}>
          <time className={styles.time}>{row.time}</time>
        </span>
        <span className={styles.text}>
          <span className={styles.minorName}>{row.name}</span>
        </span>
      </div>
    )
  }
  const place = row.kind === 'place'
  const leave = place ? stopLeaveTime({ pinId: row.pinId, time: row.time, stayMinutes: row.stayMinutes }) : null
  const dotStyle = { '--dot-color': row.wisher?.color ?? 'var(--color-text-sub)' } as CSSProperties
  return (
    <div className={styles.row}>
      {/* 建った場所は、種類の絵の代わりに模型の絵を出す（試験的。2026-11-21）。模型が読めていなければ種類の絵 */}
      <span className={place ? (model ? `${styles.dot} ${styles.modelDot}` : styles.dot) : `${styles.dot} ${styles.origin}`} style={place ? dotStyle : undefined}>
        {place ? (
          model ? (
            <ModelSprite model={model} size={60} className={styles.modelSprite} />
          ) : (
            <CategoryIcon category={(row.category ?? 'town') as PinCategory} size={20} />
          )
        ) : (
          <Icon name="train" size={20} />
        )}
      </span>
      {/* 集合場所は、集合時間と出発時間を分けて 2 段で出す（しおりと同じ） */}
      <span className={styles.times}>
        {row.meetTime ? (
          <>
            <span className={styles.slot}>
              <span className={styles.tag}>{translate('集合', "Meet")}</span>
              {clock('meet', MEET_KEY, row.meetTime)}
            </span>
            <span className={styles.slot}>
              <span className={styles.tag}>{translate('出発', "Depart")}</span>
              {clock('depart', ORIGIN_KEY, row.time)}
            </span>
          </>
        ) : (
          // 場所の行も、集合場所の行と同じく「到着」「出発」の 2 段（出発は着く時刻＋いる時間。かめの依頼、2026-11-21）
          <>
            <span className={styles.slot}>
              <span className={styles.tag}>{translate('到着', 'Arrive')}</span>
              {row.pinId ? clock('arrive', row.stopId ?? row.pinId, row.time) : <time className={styles.time}>{row.time}</time>}
            </span>
            {leave && row.pinId && (
              <span className={styles.slot}>
                <span className={styles.tag}>{translate('出発', 'Depart')}</span>
                {clock('leave', `${row.stopId ?? row.pinId}${LEAVE_MARK}`, leave)}
              </span>
            )}
          </>
        )}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{row.name}</span>
        {!place && <span className={styles.sub}>{translate('集合場所', "Meeting point")}</span>}
        {(row.lodging || row.wisher || row.wishText) && (
          <span className={styles.sub}>
            {/* 宿に決まった建物の行（地図のしおりと同じ札。下の「出発」は、翌朝に宿を出る時刻） */}
            {row.lodging && <span className={styles.stayTag}>{translate('宿泊', 'Overnight')}</span>}
            {row.wisher && <Avatar member={{ displayName: row.wisher.name, color: row.wisher.color }} size={18} />}
            {row.wishText && <span className={styles.wish}>{translate(`「${row.wishText}」`, `“${row.wishText}”`)}</span>}
          </span>
        )}
      </span>
      {sky && <WeatherIcon sky={sky} className={styles.weather} />}
    </div>
  )
}
