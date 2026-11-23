import type { TravelMode } from '../../domain/travelMode'

/** 旅の名前を考えるもとにするもの。旅を作る前（旅をつくる画面の最後の問い）に、画面から送る */
export interface SuggestTitleInput {
  /** 行く日（YYYY-MM-DD） */
  startDate: string
  /** 帰る日（日帰りなら null） */
  endDate: string | null
  /** 出発地の名前（「東京駅」） */
  origin: string
  travelMode: TravelMode
  /** 選んだ県の名前（1 つ以上） */
  prefectures: string[]
  language?: 'ja' | 'en'
}

export interface SuggestTitleOutput {
  title: string
}
