import { translate } from '@/shared/lib'
import { usePlaceReviews } from '../model/usePlaceReviews'
import styles from './PlaceReviews.module.css'

interface Props {
  tripId: string
  pinId: string
  /** 何で聞くか（確かめた場所の place_id か、候補なら 'candidate'。reviewsAsk で決める）。null なら何も出さない */
  ask: string | null
  /** 場所の情報を広げているときだけ聞く */
  active: boolean
}

/**
 * Google マップの口コミ（最大 5 件）。出せないとき（人が決める前、合言葉を通していない、聞けなかった）と、答えを待つあいだは何も出さない
 * （出せない人の画面で、見出しが出てから消えるのを防ぐ）。
 * 表示の決まり（Places API の policies）：投稿者の名前・アバター・プロフィールへのリンクを口コミのそばに出す、
 * 口コミを Google マップで開けるようにする、報告のリンクを出す、並び順を書く、Google マップの帰属を出す
 */
export function PlaceReviews({ tripId, pinId, ask, active }: Props) {
  const state = usePlaceReviews(tripId, pinId, ask, active)
  if (state.status !== 'ready') return null

  return (
    <section className={styles.reviews} aria-labelledby={`reviews-${pinId}`}>
      <h3 id={`reviews-${pinId}`} className={styles.heading}>
        {state.data.sample ? (
          translate('口コミの見本（開発用）', "Sample reviews for development")
        ) : (
          <>
            <span translate="no">{translate('Google マップ', "Google Maps")}</span>{translate('の口コミ', ' reviews')}
          </>
        )}
      </h3>
      {state.data.reviews.length === 0 && <p className={styles.note}>{translate('この場所の口コミはまだありません', "No reviews for this place yet.")}</p>}
      {state.data.reviews.length > 0 && (
        <>
          <ul className={styles.list}>
            {state.data.reviews.map((review, index) => (
              <li key={`${review.author}-${index}`} className={styles.item}>
                <div className={styles.author}>
                  {review.authorPhotoUri && <img className={styles.avatar} src={review.authorPhotoUri} alt="" width={28} height={28} referrerPolicy="no-referrer" />}
                  {review.authorUri ? (
                    <a href={review.authorUri} target="_blank" rel="noreferrer">
                      {review.author}
                    </a>
                  ) : (
                    <span>{review.author}</span>
                  )}
                  {review.rating !== null && <span className={styles.rating} aria-label={translate(`5 点中 ${review.rating} 点`, `${review.rating} out of 5`)}>{'★'.repeat(Math.round(review.rating))}</span>}
                  {review.relativeTime && <span className={styles.time}>{review.relativeTime}</span>}
                </div>
                <p className={styles.text}>{review.text}</p>
                <div className={styles.links}>
                  {review.mapsUri && (
                    <a href={review.mapsUri} target="_blank" rel="noreferrer">
                      {translate('Google マップで見る', 'View on Google Maps')}
                    </a>
                  )}
                  {review.flagUri && (
                    <a href={review.flagUri} target="_blank" rel="noreferrer">
                      {translate('報告する', 'Report')}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            {state.data.sample
              ? translate('開発環境で見た目を確かめるための見本です。本番では Google マップの口コミが出ます。', "These are development samples. The live app displays Google Maps reviews.")
              : translate('関連度の高い順に、最大 5 件を出しています。口コミは Google が確かめたものではありません。', "Showing up to five reviews, ranked by relevance. Google does not verify reviews.")}
          </p>
        </>
      )}
    </section>
  )
}
