import { forwardRef } from 'react'
import { MEMBER_NAME_MAX } from '@/entities/member'
import { originDisplayName, TRAVEL_MODE_LABELS, TRIP_ORIGIN_MAX, TRIP_TITLE_MAX, TripCalendar } from '@/entities/trip'
import type { CreateTripState } from '@/features/create-trip'
import { playSound, translate as t } from '@/shared/lib'
import { Button, ErrorText, Icon, TextInput } from '@/shared/ui'
import { goalOf, QUIZ_MODES, QUIZ_QUESTIONS } from '../model/tripQuiz'
import type { TripQuiz } from '../model/useTripQuiz'
import styles from './QuizSheet.module.css'
import { CarArt, TrainArt } from './VehicleArt'

/**
 * すぐ選べる出発地（よく集合場所に使う駅）。打つ手間を減らすためのもので、自由に書き換えられる。
 * どれも出発地の表（entities/trip の originPlaces）にあり、押すとすぐ地図に家が立つ
 */
const ORIGIN_SHORTCUTS = ['東京駅', '新宿駅', '横浜駅', '大阪駅'].map(originDisplayName)

interface Props {
  quiz: TripQuiz
  state: CreateTripState
  /** 選んだ県（最後の旅の名前の問いで、Gemini に名前を考えてもらうのに使う） */
  picked: string[]
  /** 最後の旅の名前の問いで「ここへ出発！」を押したとき（旅を作る） */
  onDepart: () => void
  /** 「ここへ出発！」を押してから、旅の画面へ移るまで（シートは下へ抜ける） */
  departing: boolean
}

/**
 * 旅をつくる画面（S01）の下のシート。「しつもん 2 / 7」と問い、答えへの一言、答える欄、「つぎへ」。
 * 「どこに行く？」は、場所を選ぶ画面（RegionPicker）が同じ形で聞く。そのあとの最後の「旅の名前は？」で「ここへ出発！」を押すと旅を作る
 */
export const QuizSheet = forwardRef<HTMLElement, Props>(function QuizSheet({ quiz, state, picked, onDepart, departing }, ref) {
  const { step, answers } = quiz
  const { info } = answers
  const beforePlace = quiz.upcoming === 'place'
  const last = step === 'title'
  const goal = answers.goal ?? info.origin

  return (
    <section ref={ref} className={departing ? `${styles.sheet} ${styles.sheetDeparting}` : styles.sheet} aria-label={QUIZ_QUESTIONS[step]} inert={departing}>
      <form
        key={step}
        className={styles.body}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (last) onDepart()
          else quiz.next()
        }}
      >
        <span className={styles.number}>
          {t('しつもん', 'Question')} {quiz.number} / {quiz.total}
        </span>
        <h2 className={styles.question}>{QUIZ_QUESTIONS[step]}</h2>
        <p className={styles.reaction} aria-live="polite">
          {quiz.reaction}
        </p>
        <div className={styles.answer}>
          {step === 'name' && (
            <TextInput
              name="displayName"
              aria-label={t('あなたの名前', 'Your name')}
              value={state.name}
              maxLength={MEMBER_NAME_MAX}
              placeholder={t('例：ゆう', 'e.g. Sam')}
              autoComplete="nickname"
              enterKeyHint="next"
              onChange={(event) => state.setName(event.target.value)}
            />
          )}
          {step === 'date' && (
            <TripCalendar start={answers.dated ? info.startDate : null} end={answers.dated ? info.endDate : null} onPick={quiz.pickDate} />
          )}
          {step === 'origin' && (
            <>
              <TextInput
                name="origin"
                aria-label={t('出発地', 'Departure point')}
                value={info.origin}
                maxLength={TRIP_ORIGIN_MAX}
                placeholder={t('駅の名前や住所', 'Station name or address')}
                autoComplete="off"
                enterKeyHint="done"
                onChange={(event) => quiz.setOrigin(event.target.value)}
                onKeyDown={(event) => {
                  // キーボードの決定を押したら、進まずにその場所を引いて地図に家を立てる（キーボードは閉じる）。変換の確定の Enter は除く
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  event.currentTarget.blur()
                  void quiz.locateOrigin()
                }}
              />
              <div className={styles.chips}>
                {ORIGIN_SHORTCUTS.map((origin) => (
                  <button
                    key={origin}
                    type="button"
                    className={info.origin.trim() === origin ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={info.origin.trim() === origin}
                    onClick={() => {
                      playSound('select')
                      quiz.setOrigin(origin)
                    }}
                  >
                    {origin}
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 'goal' && (
            <>
              <TextInput
                name="goal"
                aria-label={t('旅の最後にいたい場所', 'Where the trip ends')}
                value={goal}
                maxLength={TRIP_ORIGIN_MAX}
                placeholder={t('駅の名前や住所', 'Station name or address')}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) => quiz.setGoal(event.target.value)}
              />
              <div className={styles.chips}>
                {[...new Set([info.origin.trim(), ...ORIGIN_SHORTCUTS])].filter(Boolean).slice(0, 4).map((place) => (
                  <button
                    key={place}
                    type="button"
                    className={goalOf(answers) === place ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                    aria-pressed={goalOf(answers) === place}
                    onClick={() => {
                      playSound('select')
                      quiz.setGoal(place)
                    }}
                  >
                    {place}
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 'title' && (
            <>
              <TextInput
                name="title"
                aria-label={t('旅の名前', 'Trip name')}
                value={info.title}
                maxLength={TRIP_TITLE_MAX}
                placeholder={quiz.thinking ? t('Gemini が考えています…', 'Gemini is thinking…') : t('例：金沢 カニ旅', 'e.g. Kanazawa crab trip')}
                autoComplete="off"
                enterKeyHint="go"
                onChange={(event) => quiz.setTitle(event.target.value)}
              />
              <div>
                <Button size="small" className={styles.gemini} onClick={() => void quiz.askGemini(picked)} disabled={quiz.thinking || departing}>
                  <Icon name="sparkle" size={18} />
                  {quiz.thinking ? t('Gemini が考えています…', 'Gemini is thinking…') : t('Gemini につけてもらう', 'Ask Gemini for a name')}
                </Button>
              </div>
            </>
          )}
          {step === 'mode' && (
            <div className={styles.modes} role="radiogroup" aria-label={t('なにで行く', 'How are we getting there?')}>
              {QUIZ_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={answers.mode === mode}
                  className={answers.mode === mode ? `${styles.mode} ${styles.modeOn}` : styles.mode}
                  onClick={() => quiz.pickMode(mode)}
                >
                  {mode === 'car' ? <CarArt width={58} /> : <TrainArt width={64} />}
                  {TRAVEL_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          )}
        </div>
        {last && <ErrorText>{state.problem}</ErrorText>}
        <Button type="submit" variant="go" size="large" block sound={last ? 'confirm' : undefined} disabled={!quiz.ready || quiz.thinking || departing}>
          {beforePlace && <Icon name="map" />}
          {last ? t('ここへ出発！', 'Start this trip!') : beforePlace ? t('行き先をえらぶ', 'Choose destinations') : t('つぎへ', 'Next')}
        </Button>
      </form>
    </section>
  )
})
