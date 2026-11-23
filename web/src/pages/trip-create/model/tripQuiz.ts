import { translate as t } from '@/shared/lib'
import { memberNameProblem } from '@/entities/member'
import { type PickedPrefectures, pickedLabel, type TravelMode, TRIP_TITLE_MAX } from '@/entities/trip'
import { dateReaction, goalOf, type QuizAnswers } from './quizAnswers'

// 旅をつくる画面（S01）の 1 問 1 答。下のシートで 1 問ずつ聞き、答えるたびに上の地図が育つ。
// 問いの順番、次へ進めるか、答えへの一言を決める。画面の部品から分けた計算
// （答えの形、日程の選び方、最後の問いの一言は quizAnswers.ts）

export { goalOf, pickQuizDate, placeReaction, type PlaceTone, type QuizAnswers, quizDates } from './quizAnswers'

/**
 * 問い。name は、前に入れた名前を覚えていないときだけ、乗り物のあとに聞く。
 * goal（旅の最後にいたい場所）は出発地のすぐあとに聞き、はじめは出発地と同じにしておく。
 * 旅の名前（title）は、行き先を選んだあとの最後に聞き、答えたら旅を作る（企画書「ユーザー体験」1、Takana の依頼、2026-11-22）
 */
export type QuizStep = 'name' | 'date' | 'origin' | 'goal' | 'mode' | 'place' | 'title'

/** 問いの順番 */
export function quizSteps(askName: boolean): QuizStep[] {
  return askName
    ? ['date', 'origin', 'goal', 'mode', 'name', 'place', 'title']
    : ['date', 'origin', 'goal', 'mode', 'place', 'title']
}

/**
 * 「なにで行く？」で選べる乗り物。飛行機は出さない（Takana の依頼、2026-11-22。旅全体の飛行機は、しおりの切り替えで選べる）
 */
export const QUIZ_MODES: readonly TravelMode[] = ['transit', 'car']

export const QUIZ_QUESTIONS: Record<QuizStep, string> = {
  name: t('あなたの名前は？', 'What’s your name?'),
  date: t('いつ行く？', 'When are we going?'),
  origin: t('どこから出発する？', 'Where are we leaving from?'),
  goal: t('最後はどこに帰る？', 'Where does the trip end?'),
  mode: t('なにで行く？', 'How are we getting there?'),
  place: t('どこに行く？', 'Where are we going?'),
  title: t('旅の名前は？', 'What’s the trip called?'),
}

/** その問いの答えがそろい、次へ進めるか */
export function canGoNext(step: QuizStep, answers: QuizAnswers): boolean {
  const { info } = answers
  switch (step) {
    case 'name':
      return memberNameProblem(answers.name) === null
    case 'date':
      return answers.dated
    case 'origin':
      return info.origin.trim().length > 0
    case 'goal':
      return goalOf(answers).length > 0
    case 'mode':
      return answers.mode !== null
    case 'place':
      return true
    case 'title': {
      const title = info.title.trim()
      return title.length > 0 && title.length <= TRIP_TITLE_MAX
    }
  }
}

/** 「なにで行く？」で乗り物を選んだときの一言 */
const MODE_REACTIONS: Record<NonNullable<QuizAnswers['mode']>, string> = { car: t('ドライブだ！', 'A road trip!'), transit: t('電車の旅、いいね！', 'Time to take the train!'), plane: t('空の旅だ！', 'Up in the air!') }

/** 問いの下に出す一言（答えると、その答えに応える） */
export function quizReaction(step: QuizStep, answers: QuizAnswers): string {
  const { info } = answers
  switch (step) {
    case 'name':
      return answers.name.trim() ? t(`${answers.name.trim()}さん、よろしくね！`, `Nice to meet you, ${answers.name.trim()}!`) : t('みんなのマップに出る名前だよ', 'This name will appear on the shared map')
    case 'date':
      return dateReaction(answers)
    case 'origin':
      return info.origin.trim() ? t(`${info.origin.trim()}から出発！`, `Leaving from ${info.origin.trim()}!`) : t('よく使う場所からも選べるよ', 'You can also pick a popular station')
    case 'goal': {
      const goal = goalOf(answers)
      if (!goal) return t('旅の最後にいたい場所を入れてね', 'Enter where you want the trip to end')
      return goal === info.origin.trim() ? t(`${goal}に帰ってくる！`, `Coming back to ${goal}!`) : t(`最後は${goal}へ！`, `Ending at ${goal}!`)
    }
    case 'mode':
      return answers.mode === null ? t('どれかを選んでね', 'Choose how to travel') : MODE_REACTIONS[answers.mode]
    case 'place':
      return ''
    case 'title':
      return info.title.trim() ? t('この名前で旅を作るよ', 'We’ll create the trip with this name') : t('みんなで見る旅の名前だよ', 'Everyone will see this trip name')
  }
}

/** 選んだ場所を、帯に収まる短い名前にする（「北陸」「北海道ほか1」「全国」） */
export function shortPlaces(picked: PickedPrefectures): string {
  const parts = pickedLabel(picked).split(t('・', ', '))
  return parts.length > 1 ? t(`${parts[0]}ほか${parts.length - 1}`, `${parts[0]} +${parts.length - 1}`) : parts[0]
}
