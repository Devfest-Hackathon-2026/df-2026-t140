// しおりの日ごとの天気（気象庁の府県天気予報）を、Emulator と外の通信なしで確かめる。
// functions/src/features/shiori-weather と functions/src/adapters/jmaForecast.ts を、ビルド後の lib から読む（npm run build のあと）。
// 使い方：node --test scripts/shiori-weather.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const logic = require('../functions/lib/features/shiori-weather/logic.js')
const { shioriWeather } = require('../functions/lib/features/shiori-weather/usecase.js')
const { fetchJmaForecast, jmaForecastUrl } = require('../functions/lib/adapters/jmaForecast.js')
const { REGION_PREFECTURES } = require('../functions/lib/domain/region.js')

const {
  MAX_PREFECTURES,
  OFFICE_CODE_OF,
  assembleForecasts,
  canonicalPrefectures,
  jstDate,
  jstToday,
  officeCodesOf,
  overviewOf,
  parseOfficeForecasts,
} = logic

/** 気象庁の京都府の予報（形の見本。短期は 11/21 の 11 時、週間は 11/22 の 0 時から） */
const KYOTO = [
  {
    timeSeries: [
      {
        timeDefines: ['2026-11-21T11:00:00+09:00'],
        areas: [{ area: { name: '南部', code: '260010' }, weatherCodes: ['111'], weathers: ['晴れ 夜 くもり'] }],
      },
    ],
  },
  {
    timeSeries: [
      {
        timeDefines: ['2026-11-22T00:00:00+09:00'],
        areas: [{ area: { name: '南部', code: '260010' }, weatherCodes: ['101'] }],
      },
    ],
  },
]

test('予報の形：京都府の見本から、短期の文と週間の概況を日付で取り出す', () => {
  assert.deepEqual(parseOfficeForecasts(KYOTO), [
    { area: '南部', date: '2026-11-21', forecast: '晴れ 夜 くもり', forecastEn: 'Sunny', sky: 'sunny' },
    { area: '南部', date: '2026-11-22', forecast: '晴れ', forecastEn: 'Sunny', sky: 'sunny' },
  ])
})

test('予報の形：日付は「YYYY-MM-DD」の部分だけを取り、時刻の変換はしない', () => {
  assert.equal(jstDate('2026-11-21T23:00:00+09:00'), '2026-11-21')
  assert.equal(jstDate('2026-11-21'), '2026-11-21')
  assert.equal(jstDate('2026-13-01T00:00:00+09:00'), null)
  assert.equal(jstDate('bogus'), null)
  assert.equal(jstDate(undefined), null)
  assert.equal(jstToday(Date.UTC(2026, 10, 20, 16, 0)), '2026-11-21', '日本時間の 1 時は、その日')
})

test('予報の形：天気の記号の先頭の 1 桁で概況を決め、知らない記号は作らない', () => {
  assert.equal(overviewOf('100'), '晴れ')
  assert.equal(overviewOf('200'), 'くもり')
  assert.equal(overviewOf('300'), '雨')
  assert.equal(overviewOf('400'), '雪')
  assert.equal(overviewOf('500'), null)
  assert.equal(overviewOf(''), null)
  assert.equal(overviewOf(101), null)
})

test('短期と週間：短期にある日は短期の文を使い、週間は短期にない日だけを埋める', () => {
  const json = [
    {
      timeSeries: [
        {
          timeDefines: ['2026-11-21T11:00:00+09:00', '2026-11-22T00:00:00+09:00'],
          areas: [{ area: { name: '南部', code: '1' }, weatherCodes: ['101', '300'], weathers: ['晴れのち雨', '雨'] }],
        },
      ],
    },
    {
      timeSeries: [
        {
          timeDefines: ['2026-11-21T00:00:00+09:00', '2026-11-22T00:00:00+09:00', '2026-11-23T00:00:00+09:00'],
          areas: [{ area: { name: '南部', code: '1' }, weatherCodes: ['400', '200', '100'] }],
        },
      ],
    },
  ]
  // 11/21 は短期の「晴れのち雨」、11/22 は短期（同じ日の 2 つ目は見ない）、11/23 は週間の「晴れ」
  assert.deepEqual(parseOfficeForecasts(json), [
    { area: '南部', date: '2026-11-21', forecast: '晴れのち雨', forecastEn: 'Rain', sky: 'rain' },
    { area: '南部', date: '2026-11-22', forecast: '雨', forecastEn: 'Rain', sky: 'rain' },
    { area: '南部', date: '2026-11-23', forecast: '晴れ', forecastEn: 'Sunny', sky: 'sunny' },
  ])
})

test('短期と週間：短期に文がなく記号だけのときは、記号の概況を使う。記号も文もなければ行を作らない', () => {
  const json = [
    {
      timeSeries: [
        {
          timeDefines: ['2026-11-21T11:00:00+09:00', '2026-11-22T11:00:00+09:00'],
          areas: [{ area: { name: '北部', code: '2' }, weatherCodes: ['201', '999'] }],
        },
      ],
    },
  ]
  assert.deepEqual(parseOfficeForecasts(json), [{ area: '北部', date: '2026-11-21', forecast: 'くもり', forecastEn: 'Cloudy', sky: 'cloudy' }])
})

test('予報区の名前：地域の名前をそのまま残し、区域ごとに 1 行ずつ出す', () => {
  const json = [
    {
      timeSeries: [
        {
          timeDefines: ['2026-11-21T11:00:00+09:00'],
          areas: [
            { area: { name: '丹後', code: '260020' }, weatherCodes: ['100'], weathers: ['晴れ'] },
            { area: { name: '中部', code: '260030' }, weatherCodes: ['300'], weathers: ['雨'] },
          ],
        },
      ],
    },
  ]
  assert.deepEqual(parseOfficeForecasts(json), [
    { area: '丹後', date: '2026-11-21', forecast: '晴れ', forecastEn: 'Sunny', sky: 'sunny' },
    { area: '中部', date: '2026-11-21', forecast: '雨', forecastEn: 'Rain', sky: 'rain' },
  ])
})

test('形が違うもの：配列でない、名前のない区域、読めない日付は捨て、読めた分だけ返す', () => {
  assert.deepEqual(parseOfficeForecasts(null), [])
  assert.deepEqual(parseOfficeForecasts({ timeSeries: [] }), [])
  assert.deepEqual(parseOfficeForecasts([{ timeSeries: 'oops' }, null, 3]), [])
  const json = [
    {
      timeSeries: [
        {
          timeDefines: ['not-a-date', '2026-11-21T11:00:00+09:00'],
          areas: [
            { area: {}, weatherCodes: ['100'], weathers: ['晴れ'] },
            { area: { name: '  ' }, weatherCodes: ['100'], weathers: ['晴れ'] },
            { area: { name: '南部' }, weatherCodes: ['100', '100'], weathers: ['晴れ', '晴れ'] },
          ],
        },
      ],
    },
  ]
  assert.deepEqual(parseOfficeForecasts(json), [{ area: '南部', date: '2026-11-21', forecast: '晴れ', forecastEn: 'Sunny', sky: 'sunny' }])
})

/** 気象庁の京都府の予報の形（2026-11-22 に取ったものを縮めた。短期は 6 時間ごとの降水確率、週間は 1 日の降水確率） */
const KYOTO_POPS = [
  {
    timeSeries: [
      {
        timeDefines: ['2026-11-22T11:00:00+09:00', '2026-11-23T00:00:00+09:00', '2026-11-24T00:00:00+09:00'],
        areas: [
          {
            area: { name: '南部', code: '260010' },
            weatherCodes: ['101', '100', '203'],
            weathers: ['晴れ　昼過ぎ　から　夕方　くもり　所により　昼過ぎ　から　夜のはじめ頃　雨　で　雷を伴う', '晴れ　夜　くもり', 'くもり　時々　雨'],
          },
        ],
      },
      {
        timeDefines: ['2026-11-22T12:00:00+09:00', '2026-11-22T18:00:00+09:00', '2026-11-23T00:00:00+09:00', '2026-11-23T06:00:00+09:00', '2026-11-23T12:00:00+09:00', '2026-11-23T18:00:00+09:00'],
        areas: [{ area: { name: '南部', code: '260010' }, pops: ['20', '60', '0', '0', '0', '10'] }],
      },
      {
        timeDefines: ['2026-11-22T09:00:00+09:00'],
        areas: [{ area: { name: '京都', code: '61286' }, temps: ['15'] }],
      },
    ],
  },
  {
    timeSeries: [
      {
        timeDefines: ['2026-11-23T00:00:00+09:00', '2026-11-24T00:00:00+09:00', '2026-11-25T00:00:00+09:00', '2026-11-26T00:00:00+09:00', '2026-11-27T00:00:00+09:00'],
        areas: [{ area: { name: '南部', code: '260010' }, weatherCodes: ['100', '203', '201', '205', '400'], pops: ['', '90', '30', '60', '20'] }],
      },
    ],
  },
]

test('天気のアイコン：降水確率が 50% 以上の時間・日は雨か雪、下なら記号のとおり。6 時間ごとの確率がある日は時間帯ごとにも分ける', () => {
  assert.deepEqual(
    parseOfficeForecasts(KYOTO_POPS).map(({ date, sky, skies }) => ({ date, sky, skies })),
    [
      // 晴れの日でも、18 時からの 6 時間が 60% なので、1 日では雨。12 時からの 6 時間は 20% なので晴れ
      { date: '2026-11-22', sky: 'rain', skies: [{ hour: 12, sky: 'sunny' }, { hour: 18, sky: 'rain' }] },
      // 文に「くもり」とあっても、確率がどの時間も低いので晴れ（記号の 100）
      { date: '2026-11-23', sky: 'sunny', skies: [0, 6, 12, 18].map((hour) => ({ hour, sky: 'sunny' })) },
      // 短期の文（くもり 時々 雨）に、週間の 1 日の確率（90%）を合わせて雨
      { date: '2026-11-24', sky: 'rain', skies: undefined },
      // 週間の 201（くもり時々晴れ）で 30% はくもり
      { date: '2026-11-25', sky: 'cloudy', skies: undefined },
      // 週間の 205（くもり時々雪）で 60% は雪
      { date: '2026-11-26', sky: 'snow', skies: undefined },
      // 記号が雪（4xx）なら、確率が低くても雪
      { date: '2026-11-27', sky: 'snow', skies: undefined },
    ],
  )
})

test('天気のアイコン：降水確率がない日は、文に雨か雪が出てくれば雨か雪にする', () => {
  const parts = (code, text) => logic.skyParts(code, text)
  assert.equal(logic.daySky(parts('101', '晴れ 時々 くもり'), undefined, undefined), 'sunny')
  assert.equal(logic.daySky(parts('202', 'くもり 一時 雨'), undefined, undefined), 'rain')
  assert.equal(logic.daySky(parts('204', 'くもり 一時 雪'), undefined, undefined), 'snow')
  assert.equal(logic.daySky(parts('', 'くもり 夜 雪'), undefined, undefined), 'snow', '記号がなければ文で決める')
  assert.equal(logic.daySky(parts('300', '雨'), undefined, undefined), 'rain')
  assert.equal(logic.daySky(parts('315', '雨 後 雪'), undefined, 30), 'snow', '雪がまじれば雪。記号が雨・雪なら確率が低くても降る')
  assert.equal(logic.daySky(parts('202', 'くもり 一時 雨'), undefined, 40), 'cloudy', '確率があれば確率で決める')
  assert.equal(logic.skyParts('999', '霧'), null, '知らない記号で、文でも決まらなければ作らない')
  const foggy = [{ timeSeries: [{ timeDefines: ['2026-11-21T11:00:00+09:00'], areas: [{ area: { name: '南部' }, weatherCodes: [''], weathers: ['霧'] }] }] }]
  assert.deepEqual(parseOfficeForecasts(foggy), [{ area: '南部', date: '2026-11-21', forecast: '霧' }], '4 つに分けられない予報も、一覧の文は残す')
  assert.equal(logic.blockSky(parts('300', '雨'), 20), 'cloudy', '雨の日の降らない時間はくもり')
  assert.equal(logic.WET_POP, 50)
})

test('府県の名前：正式な名前だけを通し、重なりは 1 つにし、9 県以上は断る', () => {
  assert.deepEqual(canonicalPrefectures(['京都府', '東京都', '京都府']), { ok: true, names: ['京都府', '東京都'] })
  assert.deepEqual(canonicalPrefectures([]), { ok: true, names: [] })
  assert.deepEqual(canonicalPrefectures(['京都']), { ok: false, reason: 'invalid' })
  assert.deepEqual(canonicalPrefectures(['Tokyo']), { ok: false, reason: 'invalid' })
  assert.deepEqual(canonicalPrefectures(['toString']), { ok: false, reason: 'invalid' })
  assert.deepEqual(canonicalPrefectures([1]), { ok: false, reason: 'invalid' })
  assert.deepEqual(canonicalPrefectures('京都府'), { ok: false, reason: 'invalid' })
  assert.equal(MAX_PREFECTURES, 8)
  const eight = Object.values(REGION_PREFECTURES).flat().slice(0, 8)
  assert.equal(canonicalPrefectures([...eight, eight[0]]).ok, true, '重なりは数えない')
  assert.deepEqual(canonicalPrefectures(Object.values(REGION_PREFECTURES).flat().slice(0, 9)), { ok: false, reason: 'too-many' })
})

test('府県の予報区：47 都道府県すべてに、重ならない予報区がある（北海道・沖縄・鹿児島も）', () => {
  const names = Object.values(REGION_PREFECTURES).flat()
  assert.equal(names.length, 47)
  assert.deepEqual([...OFFICE_CODE_OF.keys()].sort(), [...names].sort())
  const codes = names.flatMap(officeCodesOf)
  assert.equal(new Set(codes).size, codes.length)
  assert.ok(codes.every((code) => /^\d{6}$/.test(code)))
  assert.equal(officeCodesOf('北海道').length, 8)
  assert.deepEqual(officeCodesOf('沖縄県'), ['471000', '472000', '473000', '474000'])
  assert.deepEqual(officeCodesOf('鹿児島県'), ['460100', '460040'])
  assert.deepEqual(officeCodesOf('京都府'), ['260000'])
  assert.deepEqual(officeCodesOf('京都'), [])
})

test('絞り込み：予定日の外と過去の日は出さず、取れなかった府県は抜き、府県の名前を付ける', () => {
  const reports = new Map([
    ['260000', KYOTO],
    ['130000', [{
      timeSeries: [{
        timeDefines: ['2026-11-20T11:00:00+09:00', '2026-11-21T11:00:00+09:00', '2026-11-23T00:00:00+09:00'],
        areas: [{ area: { name: '東部', code: '1' }, weatherCodes: ['300', '300', '300'], weathers: ['雨', '雨', '雨'] }],
      }],
    }]],
    // 016000（北海道）は取れなかった（null）
  ])
  const rows = assembleForecasts({
    prefectures: ['京都府', '東京都', '北海道'],
    reports: new Map([...reports, ['016000', null]]),
    startDate: '2026-11-21',
    endDate: '2026-11-22',
    today: '2026-11-21',
  })
  assert.deepEqual(rows, [
    { prefecture: '京都府', area: '南部', date: '2026-11-21', forecast: '晴れ 夜 くもり', forecastEn: 'Sunny', sky: 'sunny' },
    { prefecture: '東京都', area: '東部', date: '2026-11-21', forecast: '雨', forecastEn: 'Rain', sky: 'rain' },
    { prefecture: '京都府', area: '南部', date: '2026-11-22', forecast: '晴れ', forecastEn: 'Sunny', sky: 'sunny' },
  ])
})

test('絞り込み：日帰りの旅（終わりの日がない）は開始日だけ、今日より前の日は出さない', () => {
  const reports = new Map([['260000', KYOTO]])
  assert.deepEqual(
    assembleForecasts({ prefectures: ['京都府'], reports, startDate: '2026-11-21', endDate: null, today: '2026-11-21' }).map((row) => row.date),
    ['2026-11-21'],
  )
  assert.deepEqual(assembleForecasts({ prefectures: ['京都府'], reports, startDate: '2026-11-21', endDate: null, today: '2026-11-22' }), [])
})

test('取得：府県の予報区のコードだけを、固定の URL で聞く。形が違うコードは聞かない', async () => {
  assert.equal(jmaForecastUrl('260000'), 'https://www.jma.go.jp/bosai/forecast/data/forecast/260000.json')
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return new Response(JSON.stringify(KYOTO), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    assert.deepEqual(await fetchJmaForecast('../etc'), null)
    assert.equal(calls.length, 0)
    assert.deepEqual(await fetchJmaForecast('270000', () => 0), KYOTO)
    assert.deepEqual(calls, ['https://www.jma.go.jp/bosai/forecast/data/forecast/270000.json'])
  } finally {
    globalThis.fetch = original
  }
})

test('取得：同時に聞いたものは 1 回にまとめ、30 分のあいだは覚え、過ぎたら取り直す。失敗は覚えない', async () => {
  let count = 0
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    count += 1
    return new Response(JSON.stringify(KYOTO), { status: 200 })
  }
  try {
    const t0 = 1_000_000
    const [a, b] = await Promise.all([fetchJmaForecast('280000', () => t0), fetchJmaForecast('280000', () => t0)])
    assert.equal(count, 1, '同時の 2 つは 1 回')
    assert.deepEqual(a, b)
    await fetchJmaForecast('280000', () => t0 + 29 * 60_000)
    assert.equal(count, 1, '30 分より前は覚えたものを使う')
    await fetchJmaForecast('280000', () => t0 + 31 * 60_000)
    assert.equal(count, 2, '30 分を過ぎたら取り直す')
  } finally {
    globalThis.fetch = original
  }
})

test('取得：エラー・時間切れ・読めない応答は null にし、次に聞いたときは取り直す', async () => {
  let mode = 'throw'
  let count = 0
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    count += 1
    if (mode === 'throw') throw new Error('network down')
    if (mode === 'status') return new Response('nope', { status: 503 })
    return new Response('not json', { status: 200 })
  }
  try {
    assert.equal(await fetchJmaForecast('290000', () => 0), null)
    mode = 'status'
    assert.equal(await fetchJmaForecast('290000', () => 0), null)
    mode = 'json'
    assert.equal(await fetchJmaForecast('290000', () => 0), null)
    assert.equal(count, 3, '失敗は覚えず、そのたびに聞く')
  } finally {
    globalThis.fetch = original
  }
})

function fakeDb({ trip, members }) {
  const tripRef = {
    get: async () => ({ exists: trip !== undefined, data: () => trip }),
    collection: () => ({ doc: (uid) => ({ get: async () => ({ exists: members.includes(uid) }) }) }),
  }
  return { collection: () => ({ doc: () => tripRef }) }
}

const TRIP = { startDate: '2026-11-21', endDate: '2026-11-22' }

test('しおりの天気：メンバーでなければ、気象庁には聞かない', async () => {
  const asked = []
  const result = await shioriWeather(
    { db: fakeDb({ trip: TRIP, members: ['u1'] }), jma: { fetchOffice: async (code) => (asked.push(code), KYOTO) } },
    { tripId: 't', uid: 'stranger', prefectures: ['京都府'], now: Date.UTC(2026, 10, 21, 0, 0) },
  )
  assert.deepEqual(result, { status: 'not-member' })
  assert.deepEqual(asked, [])
})

test('しおりの天気：府県は予報区のコードごとに 1 回だけ聞き、1 つの予報区が失敗してもほかは出す', async () => {
  const asked = []
  const result = await shioriWeather(
    {
      db: fakeDb({ trip: TRIP, members: ['u1'] }),
      jma: {
        fetchOffice: async (code) => {
          asked.push(code)
          if (code === '471000') throw new Error('timeout')
          return code === '260000' ? KYOTO : null
        },
      },
    },
    { tripId: 't', uid: 'u1', prefectures: ['京都府', '沖縄県', '京都府', '鹿児島県'], now: Date.UTC(2026, 10, 21, 0, 0) },
  )
  assert.deepEqual([...asked].sort(), ['260000', '460040', '460100', '471000', '472000', '473000', '474000'])
  assert.deepEqual(result, {
    status: 'ok',
    forecasts: [
      { prefecture: '京都府', area: '南部', date: '2026-11-21', forecast: '晴れ 夜 くもり', forecastEn: 'Sunny', sky: 'sunny' },
      { prefecture: '京都府', area: '南部', date: '2026-11-22', forecast: '晴れ', forecastEn: 'Sunny', sky: 'sunny' },
    ],
  })
})

test('しおりの天気：旅が見つからなければ not-found', async () => {
  const result = await shioriWeather(
    { db: fakeDb({ trip: undefined, members: ['u1'] }), jma: { fetchOffice: async () => KYOTO } },
    { tripId: 't', uid: 'u1', prefectures: ['京都府'], now: 0 },
  )
  assert.deepEqual(result, { status: 'not-found' })
})
