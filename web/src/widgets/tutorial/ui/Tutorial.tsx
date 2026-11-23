import { translate as t } from '@/shared/lib'
import { Button, LanguageSwitcher } from '@/shared/ui'
import { SLIDES } from '../config/slides'
import { useSlidePlayback } from '../model/useSlidePlayback'
import { useTutorial } from '../model/useTutorial'
import { WelcomeScene } from './WelcomeScene'
import styles from './Tutorial.module.css'

/**
 * チュートリアル。画面全体を緑で覆い、1 枚に 1 つのことだけを見せる。
 * アプリの画面の短い動画（音なし、繰り返す）をスマホの形の枠に入れて上に置き、文言は画面の下に固定する（どの 1 枚でも同じ位置）。
 * 上の棒が今の位置を示し、いまの 1 枚の棒は動画の 1 周に合わせて伸び、伸び切ると次へ進む（インスタのストーリーのように）。画面のどこでも、タップ（右半分で次、左半分で前）か左右のスワイプで切り替え、最後の 1 枚のボタン（文言がそのままボタンになる）か「スキップ」で閉じる。
 * 中身（動画と文言、鳴らす音）は config/slides.ts にまとめてある
 */
export function Tutorial({ onClose }: { onClose: () => void }) {
  const { index, isFirst, isLast, lastReady, frameRef, handlers, next: goNext } = useTutorial(SLIDES.length, onClose)
  const slide = SLIDES[index]
  const next = SLIDES[index + 1]
  const { videoRef, barRef } = useSlidePlayback(slide, { isLast, onEnd: goNext })

  return (
    // タップとスワイプは、中央の枠だけでなく画面全体（緑の背景の層）で受ける。左右の半分は画面全体の幅で分ける
    <div className={styles.layer} role="dialog" aria-modal="true" aria-label={t('たびむすびの使い方', 'How to use Tabimusubi')} {...handlers}>
      <div ref={frameRef} className={styles.frame} tabIndex={-1}>
        <div className={styles.stage}>
          <div className={styles.phone}>
            {'scene' in slide.media ? (
              <WelcomeScene key={`scene-${slide.id}`} />
            ) : (
              <video
                key={`video-${slide.id}`}
                ref={videoRef}
                className={styles.image}
                src={slide.media.video}
                poster={slide.media.poster}
                muted
                loop={isLast}
                playsInline
                preload="auto"
                disablePictureInPicture
                aria-hidden="true"
              />
            )}
          </div>
        </div>
        {/* 次の 1 枚の最初の 1 コマを先に読み込んでおく（切り替えたときに、枠が空にならないように） */}
        {next && 'poster' in next.media && <link rel="preload" as="image" href={next.media.poster} />}

        <div className={styles.head}>
          <ol className={styles.bars} aria-label={t(`${SLIDES.length}枚のうち${index + 1}枚目`, `Step ${index + 1} of ${SLIDES.length}`)}>
            {SLIDES.map((item, at) => (
              <li key={item.id} className={at < index ? styles.barDone : styles.bar}>
                {/* いまの 1 枚の棒は、動画の進み具合に合わせて伸びる（useSlidePlayback） */}
                {at === index && <span key={`fill-${item.id}`} ref={barRef} className={styles.barFill} />}
              </li>
            ))}
          </ol>
          {!isLast && (
            <div className={styles.actions}>
              {isFirst && <LanguageSwitcher />}
              <button type="button" className={styles.skip} onClick={onClose}>
                {t('スキップ', 'Skip')}
              </button>
            </div>
          )}
        </div>

        <div key={`caption-${slide.id}`} className={styles.caption} aria-live="polite">
          {/* 最後の 1 枚は、文言そのものを閉じるボタンにする（文言とボタンが並んで、同じことを 2 回言わないように） */}
          {isLast ? (
            // 最後の 1 枚の動き（旅の再生）を見てもらえるよう、出てから少しのあいだは押せない（見た目も押せない形）
            <Button variant="go" size="large" block sound="open" onClick={onClose} disabled={!lastReady}>
              {slide.text}
            </Button>
          ) : (
            <p className={styles.text}>{slide.text}</p>
          )}
        </div>

        {isFirst && <p className={styles.hint}>{t('タップかスワイプで次へ', 'Tap or swipe to continue')}</p>}
      </div>
    </div>
  )
}
