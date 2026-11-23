import { type Pin, placeQuery } from '../../domain/pin'
import { sampleReviews } from './logic'
import type { PlaceReviewsPorts } from './ports'
import type { PlaceReviewsInput, PlaceReviewsResult } from './types'

/**
 * 場所の情報（S12）を開いた人に、その場所の Google マップの口コミを返す。読む → 聞く → 返す。何も書かない。
 *
 * 規約で、口コミは保存できない（Maps Platform 規約 3.2.3(a)(iii)）。開くたびに聞いて、画面に返すだけにする。
 * 口コミは模型や Gemini に渡さない（3.2.3(c)）。
 *
 * 聞くのは、口コミを出してよい設定（キーと PLACES_REVIEWS=on。本番だけで入れる）で、開いた人が旅のメンバーで、
 * 合言葉を通していて、場所を Places で確かめてある（placeId がある）か、候補（と建築に失敗したピン）か、建った場所のときだけ。
 * placeId のない候補と建った場所は、名前と地域で、場所の ID だけのテキスト検索（無料）をして place_id を見つける（かめの承諾、2026-11-08、#203）。
 * 建てた人が合言葉を通していない（用意した部品の模型で建った）と、建てたときに Places で確かめないので placeId がない。
 * それでも、しおりの再生と場所の情報には写真を出す（#279）。全員に開く切り替え（openToAll）では開かない
 * （かめの決定「本番環境かつパスワード内」、todo/humans/2026-11-08-places-reviews.md）。
 * 1 回開くたびに 1 回。1 日の回数は Google Cloud の Places（詳細）の上限で止まる
 */
export async function placeReviews(ports: PlaceReviewsPorts, input: PlaceReviewsInput): Promise<PlaceReviewsResult> {
  const tripRef = ports.db.collection('trips').doc(input.tripId)
  const [member, pinSnapshot] = await Promise.all([
    tripRef.collection('members').doc(input.uid).get(),
    tripRef.collection('pins').doc(input.pinId).get(),
  ])
  if (!member.exists) return { status: 'not-member' }
  const pin = pinSnapshot.data() as Pin | undefined
  if (!pin) return { status: 'not-found' }
  // 開発環境（Emulator）では Places を呼ばず、開発用の見本を返す（手元で見た目を確かめるため。合言葉も見ない）。
  // 写真は、建った場所（場所の情報 S12）だけ。候補の場所カードには付けない（本番と同じ）
  const language = input.language ?? 'ja'
  if (ports.placesApi.sampleMode()) return { status: 'reviews', ...sampleReviews(pin.name, pin.status === 'done', language) }
  // 候補（と建築に失敗したピン）は、まだ Places で確かめていないので、名前で探して口コミを出す（#203）
  const candidate = !pin.placeId && (pin.status === 'candidate' || pin.status === 'failed')
  // 建った場所でも、Places で確かめていなければ（建てた人が合言葉を通していない、見つからなかった）名前で探す（#279）
  const byName = candidate || (!pin.placeId && pin.status === 'done')
  if (!ports.placesApi.reviewsEnabled() || (!pin.placeId && !byName)) return { status: 'unavailable' }
  if (!(await ports.aiGate.isUnlocked(input.uid))) return { status: 'unavailable' }
  // place_id は、場所の ID だけを受け取るテキスト検索（無料）で探す。保存しない（位置ごと確かめて書くのは verify-place だけ）
  const placeId = pin.placeId ?? (await ports.placesApi.findPlaceId({ text: placeQuery(pin), near: pin.location }))
  if (!placeId) return { status: 'unavailable' }
  // 候補の場所カードには写真を出さないので、写真は取らない（Place Photo の回数を使わない）。
  // 口コミは開いた人の表示言語で聞く（英語なら Places が訳した文。言語を変えても呼ぶのは同じ 1 回）
  const found = await ports.placesApi.reviews(placeId, { photo: !candidate, language })
  return found ? { status: 'reviews', ...found } : { status: 'unavailable' }
}
