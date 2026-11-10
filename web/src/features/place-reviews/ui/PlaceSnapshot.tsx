import { type ReactNode, useState } from 'react'
import { usePlaceReviews } from '../model/usePlaceReviews'
import styles from './PlaceSnapshot.module.css'

interface Props {
  tripId: string
  pinId: string
  /** 何で聞くか（PlacePhoto と同じ）。null なら写真は聞かず、説明だけを出す */
  ask: string | null
  /** 写真の代わりの文（場所の名前） */
  name: string
  /** 写真の下の余白に書く説明（何番目か、時刻、名前、誰のやりたいことか） */
  caption: ReactNode
  /** 着いて見せているか。false のあいだは描かずに、写真だけを先に聞いておく */
  shown: boolean
}

/**
 * しおりの再生で、着いた場所の Google マップの写真 1 枚を、撮った写真のように大きく出す（白い枠と、下の余白の説明）。
 * 取り方は場所の情報の PlacePhoto と同じ答え（usePlaceReviews）を使い回し、Places を聞くのは場所ごとに 1 回で済ませる。
 * 写真を出せないとき（写真を出す設定がない、合言葉を通していない、写真がない）は、写真の枠を出さず、説明だけのカードにする。
 * 表示の決まり（Places の写真の policies）：撮った人の名前と、Google マップのプロフィールへのリンクを写真のそばに出す。
 * 画像も URL も保存しない
 */
export function PlaceSnapshot({ tripId, pinId, ask, name, caption, shown }: Props) {
  const state = usePlaceReviews(tripId, pinId, ask, true)
  // 画像が読めなかった URL（上限、期限切れ、通信の失敗）。読めなければ、写真の枠を出さない
  const [failed, setFailed] = useState<string | null>(null)
  // 聞いている途中は、まだ出さない（届いたら出す）
  if (!shown || state.status === 'loading') return null
  const photo = state.status === 'ready' && state.data.photo && state.data.photo.uri !== failed ? state.data.photo : null
  const sample = state.status === 'ready' && state.data.sample

  return (
    <figure className={styles.snapshot}>
      {photo && (
        <div className={styles.frame}>
          <img className={styles.image} src={photo.uri} alt={`${name}の写真`} referrerPolicy="no-referrer" onError={() => setFailed(photo.uri)} />
          <span className={styles.flash} aria-hidden="true" />
        </div>
      )}
      <figcaption className={styles.caption}>
        {caption}
        {photo &&
          (sample ? (
            // 開発環境の見本（自分たちで描いた絵）。Google マップの出典は付けない
            <span className={styles.credit}>見本の写真（開発用。Google マップの写真ではありません）</span>
          ) : (
            // 出典はいつも出す。撮った人がわかれば、その名前（Google マップのプロフィールへのリンク）も出す
            <span className={styles.credit}>
              写真：
              {photo.authors.map((author, index) => (
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
              {photo.authors.length > 0 ? '（' : ''}
              <span translate="no">Google マップ</span>
              {photo.authors.length > 0 ? '）' : ''}
            </span>
          ))}
      </figcaption>
    </figure>
  )
}
