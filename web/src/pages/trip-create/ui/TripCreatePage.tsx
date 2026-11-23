import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { originLocation, regionsOfPicked, seasonOf, useStations } from '@/entities/trip'
import { useCreateTrip } from '@/features/create-trip'
import { translate, useElementHeight } from '@/shared/lib'
import { RegionMap } from '@/widgets/trip-map'
import { quizDates } from '../model/tripQuiz'
import { useDepart } from '../model/useDepart'
import { useTripQuiz } from '../model/useTripQuiz'
import { QuizHeader } from './QuizHeader'
import { QuizSheet } from './QuizSheet'
import { type PickerMap, RegionPicker } from './RegionPicker'
import { SeasonFlakes } from './SeasonFlakes'
import styles from './TripCreatePage.module.css'

/**
 * 旅をつくる（S01）。下のシートで 1 問ずつ答え、上の地図に答えが重なっていく（日程の季節の舞うもの、出発地の家）。
 * 地図は、最初の問いから最後の問いまで、日本全体の Google マップ 1 つのまま（widgets/trip-map の RegionMap）。
 * 上の帯は旅の画面と同じ形で、答えた印を出す。「どこに行く？」では、大まかな場所を選ぶ画面（RegionPicker）を上に重ね、
 * 選んだ県を同じ地図に塗る。最後の「旅の名前は？」で「ここへ出発！」を押すと旅を作り、地図が選んだ場所へ寄って、
 * そのまま旅の画面へ移る（友達を招待するシートを出す）
 */
export function TripCreatePage() {
  const navigate = useNavigate()
  const state = useCreateTrip()
  const quiz = useTripQuiz(state)
  // 全国の駅の表を読み込む。読み込めたら描き直し、表の駅（浜田山駅など）にも地図の家が立つ
  useStations()
  // 選んだ大まかな場所（選んだ県の名前）。前の問いへ戻っても覚えておく
  const [picked, setPicked] = useState<string[]>([])
  // 場所を選ぶ画面が地図に映したいもの（選んだ県、サイコロ、帯とシートの高さ）
  const [pickerMap, setPickerMap] = useState<PickerMap | null>(null)
  const onMap = useCallback((map: PickerMap) => setPickerMap(map), [])
  const { departing, depart } = useDepart(
    () => (picked.length > 0 ? state.create(picked) : Promise.resolve(null)),
    (tripId) => navigate(`/t/${tripId}`, { state: { invite: true } }),
  )
  const [headerRef, headerHeight] = useElementHeight()
  const [sheetRef, sheetHeight] = useElementHeight()
  const { answers } = quiz
  const dates = quizDates(answers)
  const placing = quiz.step === 'place'
  const naming = quiz.step === 'title'
  const map = placing && pickerMap ? pickerMap : null
  const origin = answers.info.origin.trim()
  // 出発地の位置：決定を押して引いた位置があればそれ、なければ表から引いた位置（家を立てるのと、サイコロの行ける範囲に使う）
  const originPoint = origin ? (state.located?.name === origin ? state.located.location : originLocation(origin)) : null
  // 最後の旅の名前の問いでは、選んだ場所を塗ったまま見せる
  const namingRegions = useMemo(() => regionsOfPicked(picked), [picked])

  return (
    <main className={styles.page}>
      <RegionMap
        selected={map?.selected ?? (naming ? namingRegions : [])}
        pickedPrefectures={map?.pickedPrefectures ?? (naming ? picked : [])}
        topInset={map ? map.topInset : headerHeight}
        bottomInset={map ? map.bottomInset : sheetHeight}
        dive={map?.dive ?? (naming && departing)}
        origin={origin ? { name: origin, location: originPoint } : undefined}
        rolling={map?.rolling ?? null}
      />
      {answers.dated && <SeasonFlakes season={seasonOf(answers.info.startDate)} />}
      {/* 旅を作るのに時間がかかったときだけ見える（地図が寄り終わるころに出てくる） */}
      {departing && (
        <p className={styles.making} role="status">
          {translate('旅の地図を用意しています…', 'Preparing your trip map…')}
        </p>
      )}
      {/* 場所を選ぶ画面を重ねているあいだは、同じ帯を場所を選ぶ画面が出す（読み上げで帯が 2 つにならないように） */}
      {!placing && (
        <>
          <div ref={headerRef} className={departing ? `${styles.top} ${styles.topDeparting}` : styles.top} inert={departing}>
            <QuizHeader
              dates={dates}
              mode={answers.mode}
              picked={naming ? picked : undefined}
              onBack={quiz.back}
              backDisabled={quiz.number === 1}
            />
          </div>
          <QuizSheet ref={sheetRef} quiz={quiz} state={state} picked={picked} departing={departing} onDepart={() => void depart()} />
        </>
      )}
      {placing && (
        <RegionPicker
          info={state.info}
          initial={picked}
          onNext={(next) => {
            setPicked(next)
            setPickerMap(null)
            quiz.toTitle(next)
          }}
          onCancel={(next) => {
            setPicked(next)
            setPickerMap(null)
            quiz.back()
          }}
          header={(current, onBack) => (
            <QuizHeader dates={dates} mode={answers.mode} picked={current} onBack={onBack} />
          )}
          number={quiz.number}
          total={quiz.total}
          onMap={onMap}
          reach={{ from: originPoint, mode: answers.mode }}
        />
      )}
    </main>
  )
}
