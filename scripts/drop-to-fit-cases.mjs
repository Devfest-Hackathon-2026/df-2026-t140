// しおりが時間に収まらないときに外す場所を、いろいろな旅で試す（#622）。
// 自分たちの計算の順と、Gemini（手元の agy）の残したい順の両方で外し、結果を Markdown の表で出す。
// 使い方：npm run build のあとに
//   node scripts/drop-to-fit-cases.mjs            自分たちの計算の順だけ（Gemini を呼ばない）
//   GEMINI_PROVIDER=agy node scripts/drop-to-fit-cases.mjs   agy の順も試す（1 つの旅で 1 回。AGY_MAX_CALLS に数える）
// 場所の座標は、旅の見本として手で書いたおよその位置（Maps 由来の内容ではない）。
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fit = require('../functions/lib/domain/dropToFit.js')
const plan = require('../functions/lib/domain/routePlan.js')
const { rankInput, rankPlacesTask } = { ...require('../functions/lib/features/propose-routes/logic.js'), ...require('../functions/lib/features/propose-routes/prompt.js') }
const { gemini, currentProvider } = require('../functions/lib/adapters/gemini/index.js')

const TOKYO = { name: '東京駅', location: { lat: 35.681, lng: 139.767 } }
const OSAKA = { name: '大阪駅', location: { lat: 34.702, lng: 135.495 } }
const SAPPORO = { name: '札幌駅', location: { lat: 43.068, lng: 141.351 } }
const FUKUOKA = { name: '博多駅', location: { lat: 33.59, lng: 130.42 } }
const NAGANO = { name: '長野駅', location: { lat: 36.643, lng: 138.189 } }

let n = 0
const p = (name, category, lat, lng, uid, extra = {}) => ({ id: `p${(n += 1)}`, name, category, location: { lat, lng }, uid, ...extra })

const CASES = [
  {
    title: '京都 2 泊 3 日に石垣島が 2 つ（電車）',
    origin: { ...TOKYO, travelMode: 'transit' }, days: 3,
    places: [
      p('清水寺', 'shrine', 34.995, 135.785, 'a'), p('伏見稲荷大社', 'shrine', 34.967, 135.773, 'a'), p('錦市場', 'food', 35.005, 135.765, 'b'),
      p('嵐山', 'nature', 35.017, 135.677, 'b'), p('金閣寺', 'shrine', 35.039, 135.729, 'c'), p('京都タワーの夜景', 'nightview', 34.987, 135.759, 'a'),
      p('川平湾', 'nature', 24.457, 124.146, 'c'), p('竹富島', 'nature', 24.326, 124.088, 'c'),
    ],
  },
  {
    title: '長野の日帰りにスキー場が 2 つ',
    origin: NAGANO, days: 1,
    places: [
      p('白馬八方尾根スキー場', 'ski', 36.699, 137.832, 'a'), p('栂池高原スキー場', 'ski', 36.773, 137.836, 'b'),
      p('善光寺', 'shrine', 36.661, 138.187, 'c'), p('戸隠そば', 'food', 36.74, 138.09, 'a'),
    ],
  },
  {
    title: '北海道 2 泊 3 日（広い地方）',
    origin: SAPPORO, days: 3,
    places: [
      p('小樽運河', 'town', 43.199, 141.0, 'a'), p('旭山動物園', 'themepark', 43.768, 142.48, 'b'), p('富良野のラベンダー畑', 'farm', 43.418, 142.427, 'c'),
      p('知床五湖', 'nature', 44.12, 145.08, 'a'), p('函館山の夜景', 'nightview', 41.759, 140.704, 'b'), p('登別温泉', 'onsen', 42.495, 141.145, 'c'),
      p('札幌ラーメン横丁', 'food', 43.055, 141.353, 'a'),
    ],
  },
  {
    title: '関東と九州を 1 泊 2 日（複数の地方、電車）',
    origin: { ...TOKYO, travelMode: 'transit' }, days: 2,
    places: [
      p('浅草寺', 'shrine', 35.715, 139.797, 'a'), p('鎌倉の大仏', 'shrine', 35.317, 139.536, 'a'), p('箱根の温泉', 'onsen', 35.233, 139.106, 'b'),
      p('太宰府天満宮', 'shrine', 33.521, 130.535, 'c'), p('中洲の屋台', 'food', 33.592, 130.405, 'c'), p('別府の地獄めぐり', 'onsen', 33.316, 131.47, 'b'),
    ],
  },
  {
    title: '金沢 1 泊 2 日（収まる旅）',
    origin: { name: '金沢駅', location: { lat: 36.578, lng: 136.648 } }, days: 2,
    places: [
      p('兼六園', 'nature', 36.562, 136.662, 'a'), p('ひがし茶屋街', 'town', 36.573, 136.666, 'b'),
      p('近江町市場', 'food', 36.571, 136.656, 'c'), p('21 世紀美術館', 'town', 36.561, 136.658, 'a'),
    ],
  },
  {
    title: '京都の日帰りに似た寺社が 5 つ',
    origin: OSAKA, days: 1,
    places: [
      p('伏見稲荷大社', 'shrine', 34.967, 135.773, 'a'), p('清水寺', 'shrine', 34.995, 135.785, 'a'), p('金閣寺', 'shrine', 35.039, 135.729, 'b'),
      p('銀閣寺', 'shrine', 35.027, 135.798, 'b'), p('平安神宮', 'shrine', 35.016, 135.782, 'c'), p('錦市場', 'food', 35.005, 135.765, 'c'),
      p('嵐山', 'nature', 35.017, 135.677, 'a'),
    ],
  },
  {
    title: '大阪の日帰りで、1 人の希望だけが遠い',
    origin: OSAKA, days: 1,
    places: [
      p('大阪城', 'shrine', 34.687, 135.526, 'a'), p('道頓堀', 'food', 34.669, 135.501, 'a'), p('USJ', 'themepark', 34.666, 135.432, 'b'),
      p('奈良公園', 'nature', 34.685, 135.843, 'b'), p('姫路城', 'shrine', 34.839, 134.694, 'c'), p('神戸の夜景', 'nightview', 34.71, 135.2, 'c'),
    ],
  },
  {
    title: '九州と沖縄 2 泊 3 日',
    origin: FUKUOKA, days: 3,
    places: [
      p('長崎の夜景', 'nightview', 32.748, 129.865, 'a'), p('熊本城', 'shrine', 32.806, 130.706, 'b'), p('阿蘇の草千里', 'nature', 32.884, 131.06, 'c'),
      p('国際通り', 'town', 26.215, 127.686, 'a'), p('美ら海水族館', 'themepark', 26.694, 127.878, 'b'), p('中洲の屋台', 'food', 33.592, 130.405, 'c'),
    ],
  },
  {
    title: '箱根 1 泊（宿あり）に遠い場所',
    origin: TOKYO, days: 2,
    places: [
      p('箱根の宿', 'lodging', 35.233, 139.106, 'a', { lodging: { want: 1 } }), p('大涌谷', 'nature', 35.244, 139.02, 'a'), p('富士急ハイランド', 'themepark', 35.487, 138.78, 'b'),
      p('伊豆の城ヶ崎海岸', 'nature', 34.9, 139.14, 'c'), p('軽井沢', 'town', 36.343, 138.635, 'c'), p('横浜中華街', 'food', 35.443, 139.646, 'b'),
    ],
  },
  {
    title: '東京の日帰りに花火大会と日光',
    origin: TOKYO, days: 1, startDate: '2027-07-31',
    places: [
      p('隅田川花火大会', 'nightview', 35.711, 139.801, 'a', { event: { kind: 'fireworks', date: '2027-07-31', start: 19 * 60, end: 20 * 60 + 30, leadMinutes: 60, source: '見本' } }),
      p('浅草寺', 'shrine', 35.715, 139.797, 'a'), p('東京スカイツリー', 'town', 35.71, 139.811, 'b'), p('日光東照宮', 'shrine', 36.758, 139.599, 'c'),
      p('上野動物園', 'themepark', 35.716, 139.771, 'b'),
    ],
  },
]

const timing = plan.STYLE_TIMINGS.shortest
const hours = (minutes) => `${Math.round((minutes / 60) * 10) / 10} 時間`
const names = (ids, places) => (ids.length === 0 ? 'なし' : ids.map((id) => places.find((place) => place.id === id)?.name ?? id).join('、'))

const useGemini = currentProvider() !== 'stub'
const rows = []
for (const trip of CASES) {
  const origin = { ...trip.origin, ...(trip.startDate ? { startDate: trip.startDate } : {}) }
  const order = plan.settleEvents(plan.proposeOrders(trip.places, origin).shortest, origin, trip.days, timing)
  const measure = fit.measureTrip(origin, trip.days, timing)
  const before = measure(order).over
  const own = fit.dropToFit(order, origin, measure)
  let ai = null
  if (useGemini && before > fit.OVER_ALLOWANCE_MINUTES) {
    const input = rankInput(order, origin, trip.days, timing, trip.title, before)
    const result = await gemini.run(rankPlacesTask, input)
    const dropped = fit.dropToFit(order, origin, measure, result.output.ranking)
    ai = { ...dropped, provider: result.provider, ranking: result.output.ranking, after: measure(dropped.order).over }
  }
  rows.push({ trip, before, own, ownAfter: measure(own.order).over, ai })
}

console.log(`許す幅：${fit.OVER_ALLOWANCE_MINUTES} 分。順番は「移動が短い」案（shortest）、時間の決めもその案。Gemini：${useGemini ? currentProvider() : '呼ばない'}\n`)
console.log('| 旅 | 外す前の越え | 自分たちの計算で外す場所 | 外した後 | Gemini の順で外す場所 | 外した後 |')
console.log('|---|---|---|---|---|---|')
for (const { trip, before, own, ownAfter, ai } of rows) {
  const aiCell = ai ? `${names(ai.leftOut, trip.places)}${ai.rankedBy === 'given' ? '' : '（順が使えず自分たちの順）'}` : before > fit.OVER_ALLOWANCE_MINUTES ? '（呼んでいない）' : '（収まるので呼ばない）'
  console.log(`| ${trip.title}（${trip.days} 日） | ${hours(before)} | ${names(own.leftOut, trip.places)} | ${hours(ownAfter)} | ${aiCell} | ${ai ? hours(ai.after) : '―'} |`)
}
if (useGemini) {
  console.log('\nGemini の残したい順（先頭ほど残したい）：')
  for (const { trip, ai } of rows) if (ai) console.log(`- ${trip.title}：${names(ai.ranking, trip.places)}（${ai.provider}）`)
}
