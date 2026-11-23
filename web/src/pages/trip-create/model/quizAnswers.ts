import { translate as t } from '../../../shared/lib/language.ts'
import type { PickerBand, TravelMode, TripInfo } from '@/entities/trip'

// 旅をつくる画面（S01）の 1 問 1 答の答えの形と、答えから決まる計算（日程の選び方、帯の日程、最後の問いの一言）。
// ブラウザなしのテストからもそのまま呼べる形にする

/** ここまでの答え。日程と乗り物は、選ぶまで「まだ」（入力の初期値と区別する） */
export interface QuizAnswers {
  name: string
  info: TripInfo
  /** 日程の 1 日目を押したか */
  dated: boolean
  /** 帰る日を待っているか（1 日目を押したあと、まだ帰る日を押していない） */
  awaitingEnd: boolean
  /** 選んだ乗り物（まだなら null） */
  mode: TravelMode | null
  /** 旅の最後にいたい場所。打ち変えるまでは null（出発地と同じ） */
  goal: string | null
}

/** 旅の最後にいたい場所。打ち変えていなければ出発地と同じ */
export function goalOf(answers: Pick<QuizAnswers, 'info' | 'goal'>): string {
  return (answers.goal ?? answers.info.origin).trim()
}

/**
 * カレンダーで日を押したときの日程。1 回目は行く日（日帰りにしておく）、2 回目は帰る日。
 * 2 回目に行く日より前を押したら、行く日を選び直す。帰る日まで選んだあとに押すと、行く日からやり直す
 */
export function pickQuizDate(answers: QuizAnswers, date: string): Pick<QuizAnswers, 'info' | 'dated' | 'awaitingEnd'> {
  const { info } = answers
  if (!answers.dated || !answers.awaitingEnd || date < info.startDate) {
    return { info: { ...info, startDate: date, endDate: null }, dated: true, awaitingEnd: true }
  }
  return { info: { ...info, endDate: date === info.startDate ? null : date }, dated: true, awaitingEnd: false }
}

/** 最後の「どこに行く？」の一言の色。選ぶ前、選んだ、サイコロをふっている、止まった */
export type PlaceTone = 'idle' | 'picked' | 'rolling' | 'landed'

/**
 * 最後の「どこに行く？」の一言。場所を選ぶ画面の帯の中身（entities/trip の pickerBand）を、問いの下の 1 行にする。
 * 「北陸へ！ 東京駅から約290km」「サイコロをふっています… 北陸？」「北陸に決まり！」
 */
export function placeReaction(band: PickerBand, rolling: boolean, landed: boolean): { text: string; tone: PlaceTone } {
  if (rolling) return { text: `${band.sub} ${band.main}`, tone: 'rolling' }
  if (landed) return { text: band.main, tone: 'landed' }
  if (band.picked) {
    const main = `${band.main}${t('！', '!')}`
    // 英語は 1 行に収まるよう、出発地の名前を省いて「About 900 km away」にする
    const detail = t(band.sub.replace(' 約', '約'), band.sub.replace(/ from .+$/, ' away'))
    return { text: detail ? `${main} ${detail}` : main, tone: 'picked' }
  }
  return { text: t('地方を選んでね。サイコロでもいいよ', 'Choose a region or roll the dice'), tone: 'idle' }
}

/** 帯に出す日程。日程を選ぶまでは null。帰る日を待っているあいだは日帰りとして出す */
export function quizDates(answers: QuizAnswers): { start: string; end: string | null } | null {
  if (!answers.dated) return null
  return { start: answers.info.startDate, end: answers.awaitingEnd ? null : answers.info.endDate }
}


/** 出発地を引いている様子（決定を押したとき） */
export type OriginFinding = 'finding' | 'resolved' | 'not-found' | 'unavailable' | 'error'

/** 出発地を引いているときの一言。引けたら、ふだんの一言（〇〇から出発！）に戻すので null */
export function originFindingReaction(finding: OriginFinding, name: string): string | null {
  if (finding === 'finding') return t(`${name}を探しています…`, `Looking for ${name}…`)
  if (finding === 'not-found') return t('見つからなかったよ。駅の名前で入れてみてね', 'Could not find it. Try entering a station name.')
  if (finding === 'unavailable') return t('ここはまだ探せないよ。駅の名前で入れてね', 'This place cannot be searched yet. Enter a station name.')
  if (finding === 'error') return t('つながらなかったよ。もう一度決定を押してね', 'Could not connect. Press Enter to try again.')
  return null
}

/** 「いつ行く？」の一言。選んだ日数だけ（行く日だけ押したら「日帰り」、帰る日も押したら「1泊2日」。Youkin06 の選択、2026-11-21） */
export function dateReaction(answers: Pick<QuizAnswers, 'info' | 'dated' | 'awaitingEnd'>): string {
  if (!answers.dated) return t('行く日を押してね', 'Choose the first day of your trip')
  const { startDate, endDate } = answers.info
  if (answers.awaitingEnd || !endDate || endDate === startDate) return t('日帰り', '1 day')
  const nights = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000)
  return t(`${nights}泊${nights + 1}日`, `${nights + 1} days`)
}
