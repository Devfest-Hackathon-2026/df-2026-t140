import { useState } from 'react'
import { usePlaceReviews } from '../model/usePlaceReviews'
import styles from './PlacePhoto.module.css'

interface Props {
  tripId: string
  pinId: string
  /** 何で聞くか（確かめた場所の place_id か、候補なら 'candidate'。reviewsAsk で決める）。null なら何も出さない */
  ask: string | null
  /** 写真の代わりの文（場所の名前） */
  name: string
  /** 場所の情報を広げているときだけ聞く */
  active: boolean
}

/**
 * Google マップの写真 1 枚。口コミと同じ答え（usePlaceReviews）から出すので、Places を聞くのは 1 回で済む。
 * 出せないとき（写真を出す設定がない、合言葉を通していない、写真がない、待っているあいだ）は何も出さない（場所も空けない）。
 * 表示の決まり（Places の写真の policies）：撮った人の名前と、Google マップのプロフィールへのリンクを写真のそばに出す。
 * 画像も URL も保存しない（規約で写真は保存できない）
 */
export function PlacePhoto({ tripId, pinId, ask, name, active }: Props) {
  const state = usePlaceReviews(tripId, pinId, ask, active)
  // 画像が読めなかった URL（上限、期限切れ、通信の失敗）。読めなければ写真ごと出さない（壊れた画像や空いた場所を残さない）
  const [failed, setFailed] = useState<string | null>(null)
  if (state.status !== 'ready' || !state.data.photo || state.data.photo.uri === failed) return null
  const { uri, authors } = state.data.photo

  return (
    <figure className={styles.photo}>
      <img className={styles.image} src={uri} alt={`${name}の写真`} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(uri)} />
      {state.data.sample ? (
        // 開発環境の見本（自分たちで描いた絵）。Google マップの出典は付けない
        <figcaption className={styles.caption}>見本の写真（開発用。Google マップの写真ではありません）</figcaption>
      ) : (
        // 出典はいつも出す。撮った人がわかれば、その名前（Google マップのプロフィールへのリンク）も出す
        <figcaption className={styles.caption}>
          写真：
          {authors.map((author, index) => (
            <span key={`${author.name}-${index}`}>
              {index > 0 && '、'}
              {author.uri ? (
                <a href={author.uri} target="_blank" rel="noreferrer">
                  {author.name}
                </a>
              ) : (
                author.name
              )}
            </span>
          ))}
          {authors.length > 0 ? '（' : ''}
          <span translate="no">Google マップ</span>
          {authors.length > 0 ? '）' : ''}
        </figcaption>
      )}
    </figure>
  )
}
