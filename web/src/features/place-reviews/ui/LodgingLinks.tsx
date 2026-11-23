import { translate } from '@/shared/lib'
import { Icon } from '@/shared/ui'
import { bookingSearchUrl } from '../model/lodgingLinks'
import { usePlaceReviews } from '../model/usePlaceReviews'
import styles from './LodgingLinks.module.css'

interface Props {
  tripId: string
  pinId: string
  /** 宿の名前（Booking.com で探す言葉）。英語表示でも、地名とそろえて日本語の名前を渡す（検索語が英語と日本語で混ざらないように） */
  name: string
  /** あたりの地名（同じ名前の宿と見分けるため、名前のあとに足して探す） */
  area: string | null | undefined
  /** 口コミを何で聞くか（reviewsAsk）。null なら公式サイトは出さず、Booking.com だけ出す */
  ask: string | null
  /** 場所の情報を広げているときだけ聞く */
  active: boolean
}

/**
 * 宿の場所の情報（S12）と候補の場所カード（S05）に出す、宿を調べるリンク（#705）。
 * - Booking.com の検索：いつも出す。API を呼ばないリンクなので、費用も回数の上限もない
 * - 公式サイト：口コミと同じ答え（usePlaceReviews）に Places の websiteUri があるときだけ出す。Places を呼ぶ回数も料金の区分も増えない。保存しない
 * 写真はこのリンクではなく、場所の情報の PlacePhoto が出す（Place Photo は 1 日 100 回、PLACES_PHOTOS on。宿の候補カードには出さない）。
 * 料金は出さない（Takana の決定 2026-11-23、todo/humans/2026-11-23-lodging-photo-price.md）
 */
export function LodgingLinks({ tripId, pinId, name, area, ask, active }: Props) {
  const state = usePlaceReviews(tripId, pinId, ask, active)
  const website = state.status === 'ready' ? state.data.website : null
  const sample = state.status === 'ready' && state.data.sample

  return (
    <section className={styles.links} aria-labelledby={`lodging-links-${pinId}`}>
      <h3 id={`lodging-links-${pinId}`} className={styles.heading}>
        {translate('宿を調べる', 'Look up this stay')}
      </h3>
      <div className={styles.buttons}>
        {website && (
          <a className={styles.button} href={website} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} />
            {sample ? translate('公式サイト（見本）', 'Official site (sample)') : translate('公式サイト', 'Official site')}
          </a>
        )}
        <a className={styles.button} href={bookingSearchUrl(name, area)} target="_blank" rel="noreferrer">
          <Icon name="external" size={18} />
          {translate('Booking.com で探す', 'Search on Booking.com')}
        </a>
      </div>
      <p className={styles.note}>
        {translate('Booking.com では、宿の名前で探します。料金と空室は、開いたページで確かめてください。', 'Booking.com searches by the name of the stay. Check prices and availability there.')}
        {website &&
          (sample
            ? translate('公式サイトのリンクは開発用の見本です。', ' The official site link is a development sample.')
            : translate('公式サイトのリンクは Google マップの情報です。', ' The official site link is from Google Maps.'))}
      </p>
    </section>
  )
}
