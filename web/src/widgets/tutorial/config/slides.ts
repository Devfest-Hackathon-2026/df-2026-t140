import { type SoundName, translate as t } from '@/shared/lib'
// チュートリアルの中身。ここの一覧が、そのまま画面の順番になる。
//
// 直し方
// - 文言を直す：その行の text を書き換える。text の中の改行（\n）は、画面でも改行になる
// - 1 枚目（ようこそ）は動画ではなく、コードで描く場面（ui/WelcomeScene.tsx）。背景の模型は assets/welcome-models.json（地図に建つ実際の模型から選んだもの）
// - 動く画像を差し替える：assets/ の同じ名前の mp4（音なし、繰り返して流す）と、その最初の 1 コマの jpg を置き換える。
//   縦長のスマホの画面（390×844 で撮り、幅 600 に縮めた）。本物の地図で撮り、開発用の表示（見本の口コミや写真）は切り落とす
// - 1 枚足す：mp4 と jpg を assets/ に置き、下に import を 2 行と、SLIDES に 1 つ足す
// - 1 枚消す：SLIDES からその 1 つと import を消し、mp4 と jpg を消す
// - 並べ替える：SLIDES の中の順番を入れ替える
// - 音を鳴らす：cue に、動画の何秒目に、どの効果音を鳴らすかを書く（その 1 枚を初めて見たときだけ鳴る。音を切っていれば鳴らない）
// 上の棒の本数は、一覧の長さから自動で決まる。最後の 1 枚の text は、そのまま閉じるボタンの文字になる。
//
// 文言は 1 枚に 1 文ほど。前の 1 枚から続けて読めるように書く（「…建築していくと、」→「旅が出来上がっていく…」）。
// 1〜4 枚目の文言は Takana の指定（2026-11-21）。動く画像にすることと、1・2・4・5 枚目の中身、最後の文言は Lazyturtle0852 の依頼（2026-11-22）。
// 実際の画面の正確さより、何ができるかが一目で分かることを優先する（2 枚目の最後は、欄に文字が残ったまま模型が建っている）
import built from '../assets/built.mp4'
import builtPoster from '../assets/built.jpg'
import route from '../assets/route.mp4'
import routePoster from '../assets/route.jpg'
import shiori from '../assets/shiori.mp4'
import shioriPoster from '../assets/shiori.jpg'
import tour from '../assets/tour.mp4'
import tourPoster from '../assets/tour.jpg'

export interface TutorialSlide {
  /** ほかと重ならない名前（画面には出ない） */
  id: string
  /**
   * スマホの枠の中に出すもの。アプリの画面の短い動画（音なし、繰り返す）と、その最初の 1 コマ（読み込むまで出す）か、
   * 動画の代わりにコードで描く場面（welcome：真ん中にアプリの名前、後ろで実際の模型が右上へ流れる。ui/WelcomeScene.tsx）
   */
  media: { video: string; poster: string } | { scene: 'welcome' }
  /** 画面の下に出す文言。1 文ほど */
  text: string
  /** 動画の at 秒目に鳴らす効果音（その 1 枚を初めて見たときだけ） */
  cue?: { at: number; sound: SoundName }
}

export const SLIDES: TutorialSlide[] = [
  { id: 'welcome', media: { scene: 'welcome' }, text: t('みんなで旅を作ろう。\nたびむすびへようこそ！', "Let's plan a trip together.\nWelcome to Tabimusubi!") },
  {
    id: 'built',
    media: { video: built, poster: builtPoster },
    text: t('みんなで気になる場所を建築していくと、', 'Build 3D models of places you want to visit.'),
    // 模型が建つ瞬間（動画の 3.25 秒目）
    cue: { at: 3.2, sound: 'build-complete' },
  },
  { id: 'route', media: { video: route, poster: routePoster }, text: t('旅が出来上がっていくアプリ！', 'The places you build form a shared itinerary.') },
  { id: 'shiori', media: { video: shiori, poster: shioriPoster }, text: t('できた旅のしおりを持って、さあ出発！', 'Take your finished itinerary on the trip!') },
  { id: 'tour', media: { video: tour, poster: tourPoster }, text: t('素敵な旅を作りましょう！', "Let's make a wonderful trip!") },
]
