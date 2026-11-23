export interface ShioriWeatherInput {
  tripId: string
  /** 開いた人（旅のメンバーか確かめる） */
  uid: string
  /** 正式な府県の名前（logic.ts の canonicalPrefectures を通したもの） */
  prefectures: string[]
  /** 今の時刻（ミリ秒）。過去の日を出さないため */
  now: number
}

export interface ShioriWeatherForecast {
  prefecture: string
  /** YYYY-MM-DD（日本時間） */
  date: string
  /** 予報区の名前（例：南部）。気象庁の名前のまま */
  area: string
  /** 天気の文（短期）か、天気の概況（週間。晴れ・くもり・雨・雪） */
  forecast: string
  /** 天気コードから引いた英語の概況。コードがないときは付けない */
  forecastEn?: string
  /** その日の天気。しおりの行のアイコンに使う。降水確率が 50% 以上なら雨か雪。4 つに分けられない予報ではない */
  sky?: Sky
  /** 短期予報の 6 時間ごとの天気。hour は区切りの始まりの時（0、6、12、18）。6 時間ごとの降水確率がある日だけ */
  skies?: { hour: number; sky: Sky }[]
}

/** しおりの行に出す天気の 4 つ（晴れ、くもり、雨、雪）。画面はこれでアイコンを選ぶ */
export type Sky = 'sunny' | 'cloudy' | 'rain' | 'snow'

export type ShioriWeatherResult =
  | { status: 'ok'; forecasts: ShioriWeatherForecast[] }
  | { status: 'not-member' }
  | { status: 'not-found' }
