import { useNow } from '@/shared/lib'
import { useApiUsage } from '../model/useApiUsage'
import { usageView } from '../model/usageRows'
import styles from './UsagePanel.module.css'

/**
 * API の使用量（デバッグ用。プロダクトの外側の、開発・運用のための表示）。
 * PC で開いたとき、スマホの大きさの画面の右の外側に、API ごとの「使った回数 / 上限」と横棒を出す。
 * スマホの幅では何も出さない。本番では合言葉を通した人だけ（functions/src/features/api-usage）
 */
export function UsagePanel() {
  const usage = useApiUsage()
  // 0 に戻るまでの時間を進める
  const now = useNow(30_000)
  if (usage.status === 'hidden') return null

  return (
    <aside className={styles.panel} aria-label="API の使用量">
      <h2 className={styles.title}>API の使用量</h2>
      {usage.status === 'loading' && <p className={styles.note}>読み込み中…</p>}
      {usage.status === 'error' && <p className={styles.note}>読み込めませんでした。1 分後にもう一度読みます。</p>}
      {usage.status === 'ok' && (
        <ul className={styles.list}>
          {usage.rows.map((row) => usageView(row, now)).map((row) => (
            <li key={row.key} className={styles.row}>
              <div className={styles.head}>
                <span className={styles.name}>{row.name}</span>
                <span className={styles.period}>{row.period}</span>
                <span className={styles.count}>{row.count}</span>
              </div>
              <div className={styles.track}>
                <div className={styles.bar} data-tone={row.tone} style={{ inlineSize: `${row.ratio * 100}%` }} />
              </div>
              {row.reset && <span className={styles.reset}>{row.reset}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.note}>
        「今日」は、Maps 系は米国太平洋時間、Gemini Argon は日本時間で区切ります。1 分ごとに読み直します。
      </p>
    </aside>
  )
}
