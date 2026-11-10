import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { Avatar } from '@/entities/member'
import { ModelSprite } from '@/entities/model3d'
import { WishBar } from '@/features/add-wish'
import { BuildButton } from '@/features/build-model'
import { nightsLabel, playSound, type SheetEntrance, timeAgo, useElementHeight } from '@/shared/lib'
import { Button, ButtonLink, Icon, Loading, Screen } from '@/shared/ui'
import { InviteSheet } from '@/widgets/invite-sheet'
import { PlaceCard } from '@/widgets/place-card'
import { PlaceSheet } from '@/widgets/place-sheet'
import { HeaderBadge, TripHeader } from '@/widgets/trip-header'
import { type MapFocus, type MapOrigin, type MapTour, TripMap } from '@/widgets/trip-map'
import { PlacePhoto, PlaceReviews, PlaceSnapshot, reviewsAsk } from '@/features/place-reviews'
import { placeNote, placeReviewsAsk } from '../model/shiori'
import { ORIGIN_SPOT, spotNeighbors, spotOrder } from '../model/spots'
import { useShioriCoach } from '../model/useShioriCoach'
import { useShioriTour } from '../model/useShioriTour'
import { useTripMap } from '../model/useTripMap'
import { ShioriCoachMark } from './ShioriCoachMark'
import { ShioriSheet } from './ShioriSheet'
import styles from './TripMapPage.module.css'

/** しおりのシートの外側に浮かぶ再生ボタンの高さと、シートとのすきま（px。ShioriSheet.module.css の .play） */
const PLAY_BUTTON_SPACE = 56 + 12 + 8

/**
 * みんなの地図（S02、S04、S05、S07）と、同じ地図の上のしおり（S11、S12、S13）。
 * 地図の上に、上の帯と下の操作欄が重なる。上の帯は、左上がルートボタン（しおり）か戻るボタン、右上がホームボタン。
 * まん中の旅の名前の帯には、メンバーの顔が並ぶ。帯を押すと、どの状態からでも、メンバーと招待のシートが下に開く（#231）。
 *
 * みんなの地図（ふだん）。下の操作欄は場面で切り替わる：
 *   ふだん（S04）        やりたいことを書く欄
 *   ピンを選んだ（S05）  場所カード。候補なら「建築する！」。押すと裏で建築が始まり、すぐ書く欄に戻る
 *   招待（S02）          友達を招待するシート。旅を作った直後に出す。上の旅の名前の帯からいつでも開ける
 * 建物が建つと、上の帯の下の行に「○○が建った・たった今」が出て、地図のその場所に青い輪郭線つきで建ち、しおりに入る（S07）。
 * 画面はふさがない。その旅のしおりに初めて場所が入ったときだけ、左上のルートボタンを指す案内を出す（ShioriCoachMark）。
 *
 * しおり（URL に ?view=shiori）。左上のルートボタンで開き、左上の戻るボタンで、やりたいことを書く画面に戻る：
 *   しおり（S11）          建った場所が旅の順に並び、地図に道順が出る
 *   場所の情報（S12）      行か地図の建物を押すと、その建物にズームし、シートが場所の情報になる（&place=ピンの ID）。
 *                          寄り具合は、まわりの建物の混み具合で地図が決める（#224）。先頭の集合場所の行を押すと、
 *                          集合場所の情報になる（&place=@origin。#226）。左右のスワイプで、集合場所 → しおりの順の建物と回る
 *   シートを閉じた状態（S13）場所の情報を見ているときに地図を動かすと、シートの上の部分だけが残る
 *   しおりでも、地図を動かすか何もない所を押すと、シートが日程の行だけ残して下がる。そこを押すと元に戻る
 *   旅の再生              しおりの再生ボタンで、車が道順をたどって場所を順に回る。下の欄は出さず、着いたら「パシャ」と鳴らして
 *                         その場所の写真を大きく出す。戻るボタン、地図に触れると止まる。最後まで行ったら、しおりに戻る
 * 地図は 1 つのまま切り替えるので、しおりを開いても地図を読み込み直さない。
 */
export function TripMapPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const map = useTripMap(tripId, { shioriOpen: params.get('view') === 'shiori' })
  const justCreated = Boolean((location.state as { invite?: boolean } | null)?.invite)
  // 招待のシート。'create' は旅を作った直後（「次へ：計画をはじめる」を出す）、'open' は顔のボタンから開いたとき
  // 'open' は上の旅の名前の帯から開いたとき（みんなの地図でも、しおりでも。#231）
  const [inviting, setInviting] = useState<'create' | 'open' | false>(justCreated ? 'create' : false)
  // 下のシート（しおり、場所の情報）を、上の部分だけ残して下げているか。地図に触れると下がる
  const [peek, setPeek] = useState(false)
  // しおりを開いてから、地図に触れたか（指で動かした、何もない所を押した）。触れたあとは、
  // しおりのシートが下がる・上がるなどで高さが変わっても、地図を合わせ直さない
  const [mapTouched, setMapTouched] = useState(false)
  // 場所の情報のシートが出てきた理由（前後の場所へ移ったときは小さく動くだけ。それ以外は下から上がる）
  const [entrance, setEntrance] = useState<SheetEntrance>('open')
  // 場所カードをスワイプして前後の候補を選んだときの向き（カードが入ってくる向き）。地図でピンを押したときは null
  const [cardEnter, setCardEnter] = useState<'next' | 'prev' | null>(null)
  const [topRef, topHeight] = useElementHeight()
  const [bottomRef, bottomHeight] = useElementHeight()

  // 「作った直後」の目印は、一度使ったら消す。残っていると、読み込み直すたびに招待のシートがまた開く
  useEffect(() => {
    if (justCreated) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [justCreated, navigate, location.pathname, location.search])

  const shiori = params.get('view') === 'shiori'
  const placeId = shiori ? params.get('place') : null
  const placeIndex = placeId ? map.shioriStops.findIndex((item) => item.pin.id === placeId) : -1
  const place = placeIndex >= 0 ? map.shioriStops[placeIndex] : null
  // 集合場所の情報を見ているか（#226）。集合場所は建物ではないので、建物の数・番号・旅程には入れない
  const origin = map.shioriOrigin
  const atOrigin = placeId === ORIGIN_SPOT && origin !== null
  // 場所の情報（S12）の写真と口コミを何で聞くか（model/shiori.ts の placeReviewsAsk）
  const placeAsk = place ? placeReviewsAsk(place.pin.placeId) : null
  // 場所の情報で、左右にのぞかせる前・次。並びは、集合場所 → しおりの順の建物（端なら null。一周しない）
  const spotIds = spotOrder(map.shioriStops.map((item) => item.pin.id))
  const around = placeId && (place || atOrigin) ? spotNeighbors(spotIds, placeId) : null
  const spotName = (id: string) => (id === ORIGIN_SPOT ? (origin?.name ?? '') : (map.shioriStops.find((item) => item.pin.id === id)?.pin.name ?? ''))

  // 画面（地図、しおり、場所の情報）が変わったら、下げたシートと「地図に触れた」を戻す。
  // ボタンで移るときも、端末の戻る・進む操作（URL だけが変わる）でも、ここで戻す
  const screen = shiori ? `shiori-${placeId ?? ''}` : 'map'
  const [shownScreen, setShownScreen] = useState(screen)
  if (shownScreen !== screen) {
    setShownScreen(screen)
    setPeek(false)
    setMapTouched(false)
    // メンバーと招待のシートも閉じる（開いたまま別の画面へ移ったとき。シートを閉じると、移った先の画面に戻る）
    setInviting(false)
  }

  // 履歴：画面を切り替えるたびに 1 つ積む（地図 → しおり → 場所の情報 → しおり → 地図）。端末の戻る操作で、
  // 見てきた画面を順に戻れる。history.back() は使わない（複数人シミュレーションの iframe では、ほかの画面の履歴まで戻すため）
  const openShiori = () => {
    playSound('open')
    map.selectPin(null)
    map.markShioriSeen()
    setInviting(false)
    setParams({ view: 'shiori' })
  }
  const closeShiori = () => { playSound('close'); setParams({}) }
  const openPlace = (pinId: string, how: SheetEntrance = 'open') => {
    if (pinId !== placeId && how === 'open') playSound('select')
    setPeek(false)
    setEntrance(how)
    // 場所の情報から別の建物を押したときは、積まずに置き換える
    setParams({ view: 'shiori', place: pinId }, { replace: Boolean(placeId) })
  }
  // 下げたシートと「地図に触れた」は、画面が変わったときに上で戻す
  const backToShiori = () => { playSound('close'); setParams({ view: 'shiori' }) }
  // 地図に触れた：しおりでも場所の情報でも、シートを上の部分だけ残して下げる。地図はそのまま（合わせ直さない）
  const lowerSheet = () => {
    if (!peek) playSound('close')
    setMapTouched(true)
    setPeek(true)
  }
  // 取っ手を下へドラッグした（か、押した）：シートを下げる。地図には触れていないので mapTouched は立てない
  // （しおりでは、シートが下がって広くなった地図に、建った場所が全部見えるよう合わせ直す）
  const collapseSheet = () => { if (!peek) playSound('close'); setPeek(true) }
  const expandSheet = () => { if (peek) playSound('open'); setPeek(false) }

  // しおりを見ている間に入った場所は、もう見たことにする
  const { shioriHasNew, markShioriSeen } = map
  useEffect(() => {
    if (shiori && shioriHasNew) markShioriSeen()
  }, [shiori, shioriHasNew, markShioriSeen])

  // しおりの入口の案内（ShioriCoachMark）。その旅のしおりに初めて場所が入ったとき、左上のルートボタンが見えていれば出す
  const routeSlot = useRef<HTMLSpanElement>(null)
  const hasStops = map.shioriStops.length > 0
  const coach = useShioriCoach(tripId, hasStops, !map.loading && !shiori && !inviting && map.selection === null)
  // しおりを開いた（ルートボタンでも、戻る・進む操作でも）ら、案内は済んだことにする
  const coachDone = coach.done
  useEffect(() => {
    if (shiori && hasStops) coachDone()
  }, [shiori, hasStops, coachDone])

  // しおりで地図を合わせるときの、下のシートの高さ。地図に触れたあとは止める。
  // そうしないと、シートが下がる・上がるたびに地図が全体へ戻り、指で動かしている地図と取り合う
  const [fitHeight, setFitHeight] = useState(bottomHeight)
  if (!mapTouched && fitHeight !== bottomHeight) setFitHeight(bottomHeight)

  // 旅の再生（しおりの再生ボタン）。止まったら（最後まで行った、やめた）、しおりに戻って全体を見せ直す
  const [toursDone, setToursDone] = useState(0)
  const tourStops = useMemo(() => map.shioriStops.map((item) => item.pin.location), [map.shioriStops])
  const finishTour = () => {
    setParams({ view: 'shiori' }, { replace: true })
    setPeek(false)
    setMapTouched(false)
    setToursDone((count) => count + 1)
  }
  const tour = useShioriTour(tourStops, map.shioriLegs, map.shioriOriginLeg, finishTour)
  const stopTour = () => {
    playSound('close')
    tour.stop()
    finishTour()
  }
  const touring = shiori && tour.playing && tour.now !== null
  // 再生中は、車が走る集合場所から 1 つ目の場所までの線も出す
  const { shioriLines, shioriOriginLeg } = map
  const mapLines = useMemo(
    () => (touring && shioriOriginLeg ? [{ id: 'tour-origin', points: shioriOriginLeg }, ...shioriLines] : shioriLines),
    [touring, shioriOriginLeg, shioriLines],
  )
  const tourStop = touring ? map.shioriStops[tour.now!.index] : null
  const mapTour = useMemo<MapTour | null>(() => {
    const now = tour.now
    if (!shiori || !now) return null
    // 寄り具合は、地図が区間の長さから決める（建物と建物のあいだが、画面の縦の長さの半分より長く見えるように）
    return { leg: now.leg, progress: now.progress }
  }, [shiori, tour.now])
  // しおりから離れたら止める（戻るボタン、端末の戻る操作）
  const { stop: haltTour, playing: tourPlaying } = tour
  useEffect(() => {
    if (!shiori && tourPlaying) haltTour()
  }, [shiori, tourPlaying, haltTour])

  // しおりの地図の動き：場所の情報ではその場所を真ん中に（寄り具合は、まわりの建物の混み具合で地図が決める。#224）、
  // しおりでは建った場所が全部見えるように。集合場所の位置が分からないときは、地図を動かさない（#226）
  const shioriPinIds = map.shioriPins.map((pin) => pin.id).join('.')
  const placePinId = place?.pin.id
  const spotKey = place ? place.pin.id : atOrigin ? ORIGIN_SPOT : null
  const spotPoint = place ? place.pin.location : atOrigin ? origin?.location : null
  const spotLat = spotPoint?.lat
  const spotLng = spotPoint?.lng
  const shioriFocus = useMemo<MapFocus | null>(() => {
    if (!shiori || fitHeight === 0) return null
    if (spotKey) {
      return spotLat !== undefined && spotLng !== undefined ? { key: `place-${spotKey}`, spot: { lat: spotLat, lng: spotLng }, pinId: placePinId } : null
    }
    return shioriPinIds ? { key: `shiori-${shioriPinIds}-${fitHeight}-${toursDone}`, pinIds: shioriPinIds.split('.') } : null
  }, [shiori, spotKey, spotLat, spotLng, placePinId, shioriPinIds, fitHeight, toursDone])
  // しおりの地図に出す集合場所の印（位置が分かるときだけ）
  const originName = origin?.name
  const originLat = origin?.location?.lat
  const originLng = origin?.location?.lng
  const originMark = useMemo<MapOrigin | null>(
    () =>
      originName && originLat !== undefined && originLng !== undefined
        ? { name: originName, location: { lat: originLat, lng: originLng }, selected: atOrigin }
        : null,
    [originName, originLat, originLng, atOrigin],
  )

  // 地図でピンを押した：カードは下から出る（横から入る動きは付けない）
  const selectFromMap = (pinId: string | null) => {
    if (pinId !== map.selectedPinId) {
      if (pinId) playSound('select')
      else if (map.selectedPinId) playSound('close')
    }
    setCardEnter(null)
    map.selectPin(pinId)
  }
  // 場所カードをスワイプして（か、左右にのぞくカードを押して）、前後の場所を選んだ。
  // 候補どうしなら地図はそのまま（立ったときに全部見えるよう合わせてある）。建物どうしなら、離れていることが多いので地図をその建物へ寄せる
  const swipeToNeighbor = (pinId: string, direction: 'next' | 'prev', building: boolean) => {
    setCardEnter(direction)
    map.selectPin(pinId)
    if (building) map.showPins([pinId])
  }

  if (map.loading) return <Loading />

  const { trip, members, selection, activity } = map
  if (!trip || !members) {
    return (
      <Screen>
        <p>この旅を読み込めませんでした。もう一度開くか、ホームから選び直してください。</p>
        <ButtonLink to="/" block>
          ホームへ
        </ButtonLink>
      </Screen>
    )
  }

  const counts = (
    <>
      <HeaderBadge tone="build" icon="house" label={`建物 ${map.counts.buildings}`}>
        {map.counts.buildings}
      </HeaderBadge>
      <HeaderBadge tone="go" icon="pin" label={`ピン ${map.counts.pins}`}>
        {map.counts.pins}
      </HeaderBadge>
    </>
  )

  // 上の旅の名前の帯を押した：メンバーと招待のシートを下に開く（どの状態からでも。#231）。旅の再生は止める
  const openMembers = () => {
    if (touring) stopTour()
    if (!inviting) playSound('open')
    setInviting((now) => now || 'open')
  }
  const inviteSheet = (
    <InviteSheet
      tripId={tripId}
      tripTitle={trip.title}
      members={members}
      myUid={map.myUid}
      showNext={inviting === 'create'}
      onClose={() => setInviting(false)}
      onLeaving={() => navigate('/')}
    />
  )

  if (shiori) {
    const inPlace = Boolean(place) || atOrigin
    return (
      // しおりのときは、画面の縁に細い緑の枠を付ける（みんなの地図とは別の画面にいると分かるように）
      <div className={`${styles.page} ${styles.shioriFrame}`}>
        <TripMap
          pins={map.shioriPins}
          members={members}
          models={map.models}
          celebratingPinId={null}
          selectedPinId={place?.pin.id ?? null}
          // 建物を押すとその場所の情報。場所の情報を見ているときに地図のほかのところを押すと、しおりに戻る（みんなの地図で場所カードが閉じるのと同じ）。
          // しおりを見ているときに地図のほかのところを押すと、しおりのシートが下がる
          onSelectPin={(pinId) => {
            if (touring) stopTour()
            if (pinId) openPlace(pinId)
            else if (inPlace) backToShiori()
            else if (!touring) lowerSheet()
          }}
          onViewChange={map.onViewChange}
          focus={shioriFocus}
          topInset={topHeight}
          // 一覧でも場所の情報でも、シート外側の再生ボタンにGoogleのロゴが隠れないよう余白を取る
          bottomInset={bottomHeight + (!touring && !inviting && hasStops ? PLAY_BUTTON_SPACE : 0)}
          lines={mapLines}
          orders={map.shioriOrders}
          buildingSize={inPlace ? 140 : 110}
          // 集合場所の印（位置が分かるときだけ）。押すと集合場所の情報
          origin={originMark}
          onSelectOrigin={() => {
            if (touring) stopTour()
            openPlace(ORIGIN_SPOT)
          }}
          // 再生中に地図を指で動かしたら、再生を止める
          onUserMove={touring ? stopTour : lowerSheet}
          tour={mapTour}
        />

        <div className={styles.top} ref={topRef}>
          <TripHeader
            title={trip.title}
            left={
              // 戻るボタンは、左の緑の枠から生えたタブの形（大きさと位置は、ふだんのボタンと同じ）
              <Button
                iconOnly
                className={styles.backTab}
                aria-label={touring ? '再生をやめる' : 'やりたいことを書く画面に戻る'}
                onClick={touring ? stopTour : closeShiori}
              >
                <Icon name="back" />
              </Button>
            }
            badges={counts}
            members={members}
            onOpenMembers={openMembers}
            membersOpen={Boolean(inviting)}
          />
          {/* いまの画面の名前（しおり）と、再生中の印。押せないので、押せるボタンの形（塗り・縁・影）にしない（#227） */}
          {touring ? (
            // 再生中は、何番目の場所かを出す。止めるのは左上の戻るボタン
            <p className={styles.shioriChip}>
              <Icon name="play" size={18} />
              旅を再生中 {tour.now!.index + 1} / {map.shioriStops.length}
            </p>
          ) : (
            <h2 className={styles.shioriChip}>
              <Icon name="bookmark" size={18} />
              しおり
            </h2>
          )}
          {/* 手元（Emulator）の見本の曲線のとき。本物の道の形と見分けられるように（#218） */}
          {map.shioriLineSample && <p className={styles.sampleNote}>道の線は開発用の見本です（本番では道に沿います）</p>}
        </div>

        <div className={styles.spacer} />

        <div className={styles.bottom} ref={bottomRef}>
          {inviting ? (
            inviteSheet
          ) : touring && tourStop ? (
            // 再生中は下の欄を出さない。着いたら、その場所の写真を撮った写真のように大きく出す（地図は、その上の残りで建物を映す）。
            // 向かっているあいだに写真を聞いておき、着いたら出す。聞くのは場所ごとに 1 回（口コミと同じメモリーを使い回す）
            <div className={styles.snapshot}>
              <PlaceSnapshot
                key={tourStop.pin.id}
                tripId={tripId}
                pinId={tourStop.pin.id}
                ask={placeReviewsAsk(tourStop.pin.placeId)}
                name={tourStop.pin.name}
                shown={tour.now!.phase === 'arrive'}
                caption={
                  <>
                    <span className={styles.snapshotTime}>
                      {tour.now!.index + 1} / {map.shioriStops.length}・{tourStop.stop.time}
                    </span>
                    <span className={styles.snapshotName}>{tourStop.pin.name}</span>
                    {(tourStop.wisher || tourStop.wishText) && (
                      <span className={styles.snapshotWish}>
                        {tourStop.wisher && <Avatar member={tourStop.wisher} size={18} />}
                        {tourStop.wishText && <span>「{tourStop.wishText}」</span>}
                      </span>
                    )}
                  </>
                }
              />
            </div>
          ) : atOrigin && origin ? (
            // 集合場所の情報（#226）。建物ではないので、写真・口コミ・番号は出さない
            <PlaceSheet
              key={ORIGIN_SPOT}
              spot={{ kind: 'origin', name: origin.name, located: origin.location !== null }}
              time={origin.time}
              peek={peek}
              onBack={backToShiori}
              onExpand={expandSheet}
              onCollapse={collapseSheet}
              onPlay={hasStops ? () => tour.play() : undefined}
              next={around?.next ? { name: spotName(around.next), go: () => openPlace(around.next!, 'switch') } : undefined}
              entrance={entrance}
            />
          ) : place ? (
            <PlaceSheet
              // 場所が変わるたびに作り直す（シートが動いて、変わったことが分かる）
              key={place.pin.id}
              spot={{
                kind: 'place',
                pin: place.pin,
                order: placeIndex + 1,
                total: map.shioriStops.length,
                stayMinutes: place.stop.stayMinutes,
                wisher: place.wisher,
                wishText: place.wishText,
              }}
              time={place.stop.time}
              note={placeNote(map.loadedModels[place.pin.id]?.source)}
              photo={<PlacePhoto tripId={tripId} pinId={place.pin.id} ask={placeAsk} name={place.pin.name} active={!peek} />}
              extra={<PlaceReviews tripId={tripId} pinId={place.pin.id} ask={placeAsk} active={!peek} />}
              credit={map.loadedModels[place.pin.id]?.reference}
              peek={peek}
              onBack={backToShiori}
              onExpand={expandSheet}
              onCollapse={collapseSheet}
              onPlay={() => tour.play(placeIndex)}
              prev={around?.prev ? { name: spotName(around.prev), go: () => openPlace(around.prev!, 'switch') } : undefined}
              next={around?.next ? { name: spotName(around.next), go: () => openPlace(around.next!, 'switch') } : undefined}
              entrance={entrance}
            />
          ) : (
            <ShioriSheet
              trip={trip}
              route={map.shioriRoute}
              pins={map.shioriPins}
              members={members}
              wishes={map.wishes}
              onSelectPlace={openPlace}
              onSelectOrigin={() => openPlace(ORIGIN_SPOT)}
              peek={peek}
              onExpand={expandSheet}
              onCollapse={collapseSheet}
              onPlay={() => tour.play()}
            />
          )}
        </div>
      </div>
    )
  }

  const showingPin = selection && !inviting
  return (
    // 案内を出している間は、明るく残したルートボタン（案内の中の丸）しか押せないように、後ろの画面を inert にする
    <div className={styles.page} inert={coach.show}>
      {coach.show && (
        <ShioriCoachMark
          target={routeSlot}
          onOpen={() => {
            coach.done()
            openShiori()
          }}
        />
      )}
      <TripMap
        pins={map.pins}
        members={members}
        models={map.models}
        celebratingPinId={map.builtPinId}
        selectedPinId={inviting ? null : map.selectedPinId}
        onSelectPin={selectFromMap}
        onViewChange={map.onViewChange}
        focus={map.focus}
        topInset={topHeight}
        bottomInset={bottomHeight}
        // しおりを開いていなくても、建てた場所をつなぐ道順と回る順番を出す
        lines={map.shioriLines}
        orders={map.shioriOrders}
      />

      <div className={styles.top} ref={topRef}>
        {/* 上の帯は 1 か所に置き、状態で中身だけを変える（帯を押したとき、帯が作り直されてフォーカスが外れないように） */}
        <TripHeader
          title={showingPin ? (selection.wishText ?? selection.pin.name) : trip.title}
          left={
            showingPin ? (
              <Button sound="close" iconOnly aria-label="みんなの地図に戻る" onClick={() => map.selectPin(null)}>
                <Icon name="back" />
              </Button>
            ) : inviting ? undefined : (
              // 左上のルートボタン：しおり（S11）を開く。まだ見ていない場所が入ったら「NEW」
              <span className={styles.routeSlot} ref={routeSlot}>
                <Button
                  variant="route"
                  iconOnly
                  aria-label={map.shioriHasNew ? 'しおりを開く（新しい場所が入りました）' : 'しおりを開く'}
                  className={styles.routeButton}
                  onClick={openShiori}
                >
                  <Icon name="route" />
                </Button>
                {map.shioriHasNew && (
                  <span className={styles.newBadge} aria-hidden="true">
                    NEW
                  </span>
                )}
              </span>
            )
          }
          badges={
            showingPin ? (
              <HeaderBadge tone="go" icon="pin" label={`候補 ${selection.total}`}>
                {selection.total}
              </HeaderBadge>
            ) : inviting ? (
              <HeaderBadge tone="route" icon="calendar" label={nightsLabel(trip.startDate, trip.endDate)}>
                {nightsLabel(trip.startDate, trip.endDate)}
              </HeaderBadge>
            ) : (
              counts
            )
          }
          right={showingPin ? null : undefined}
          members={members}
          onOpenMembers={openMembers}
          membersOpen={Boolean(inviting)}
        />
        {!showingPin && (
          <>
            {activity && !inviting && (
              // 上の帯の下の行：いちばん新しいできごと（メンバーの顔は、上の旅の名前の帯に入れた。#231）。
              // 建物が建ったお知らせ（S07）も、ここに「○○が建った・たった今」と出る（大きなお知らせは出さない）
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.activity}
                  onClick={() => { playSound('select'); map.showPins(activity.pinIds) }}
                  aria-label={`${activity.shared ? '' : `${activity.member?.displayName ?? 'だれか'}：`}${activity.text}（${timeAgo(activity.at, map.now)}）`}
                >
                  {activity.member && <Avatar member={activity.member} size={26} />}
                  <span className={styles.activityText}>{activity.text}</span>
                  {activity.busy ? (
                    <span className={styles.busy} aria-hidden="true" />
                  ) : (
                    <span className={styles.ago}>・{timeAgo(activity.at, map.now)}</span>
                  )}
                </button>
              </div>
            )}
            {map.viewLabel && !inviting && (
              <p className={styles.view}>
                <Icon name="eye" size={18} />
                <span>{map.viewLabel}</span>
                <span className={styles.srOnly}>のあたりから探します</span>
              </p>
            )}
          </>
        )}
      </div>

      <div className={styles.spacer} />

      <div className={styles.bottom} ref={bottomRef}>
        {inviting ? (
          inviteSheet
        ) : selection ? (
          <PlaceCard
            // ピンごとに作り直す（スワイプで選び直したとき、入ってくる動きで変わったことが分かる）
            key={selection.pin.id}
            pin={selection.pin}
            index={selection.index}
            total={selection.total}
            wisher={selection.wisher}
            wishText={selection.wishText}
            thumbnail={
              selection.pin.status === 'done' && map.models[selection.pin.id] ? (
                <ModelSprite model={map.models[selection.pin.id]} size={76} />
              ) : undefined
            }
            state={
              selection.pin.status === 'building'
                ? `${selection.builder ? `${selection.builder.displayName}が` : ''}建築中です。できたら、地図に建ちます`
                : selection.pin.status === 'done'
                  ? `${selection.builder ? `${selection.builder.displayName}が建てました` : '建ちました'}${
                      map.loadedModels[selection.pin.id]?.source === 'argon' ? '' : '（用意した部品の模型です）'
                    }`
                  : selection.pin.status === 'failed'
                    ? '前の建築は失敗しました。もう一度建てられます'
                    : undefined
            }
            prev={selection.prev ? { name: selection.prev.name, go: () => swipeToNeighbor(selection.prev!.id, 'prev', selection.amongBuildings) } : undefined}
            next={selection.next ? { name: selection.next.name, go: () => swipeToNeighbor(selection.next!.id, 'next', selection.amongBuildings) } : undefined}
            enter={cardEnter ?? undefined}
            // 口コミ：候補（と建築に失敗したピン）のカードだけで出す（#203。建てる前に選ぶため）。建った建物の口コミは
            // しおりの場所の情報（S12）で出す（カードを払うたびに口コミの 1 日の回数を使わないように）。
            // 出せるかは Functions が決める（本番、合言葉）。出せないときは何も出ない
            extra={
              <PlaceReviews
                tripId={tripId}
                pinId={selection.pin.id}
                ask={selection.pin.status === 'candidate' || selection.pin.status === 'failed' ? reviewsAsk(selection.pin) : null}
                active
              />
            }
            action={
              selection.pin.status === 'candidate' || selection.pin.status === 'failed' ? (
                <BuildButton
                  // ピンごとに作り直す（前のピンの「断られた理由」を残さない）
                  key={selection.pin.id}
                  tripId={tripId}
                  pinId={selection.pin.id}
                  builtCount={map.counts.buildings}
                  retry={selection.pin.status === 'failed'}
                  onRequested={map.onBuildRequested}
                />
              ) : undefined
            }
          />
        ) : (
          <WishBar tripId={tripId} getBounds={map.getBounds} onAdded={() => {}} />
        )}
      </div>
    </div>
  )
}
