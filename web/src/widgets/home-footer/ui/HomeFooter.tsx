import { Link } from 'react-router'
import { playSound, translate as t } from '@/shared/lib'
import { Icon, type IconName } from '@/shared/ui'
import styles from './HomeFooter.module.css'

type Tab = 'home' | 'collection'

const TABS: { id: Tab; to: string; label: string; icon: IconName }[] = [
  { id: 'home', to: '/', label: t('ホーム', 'Home'), icon: 'home' },
  { id: 'collection', to: '/collection', label: t('コレクション', 'Collection'), icon: 'collection' },
]

/**
 * ホームとコレクションの下に出すフッター（企画書「ユーザー体験」4-2）。左がホーム、右がコレクション。
 * 画面の下に固定する。中身がフッターに隠れないよう、同じ高さの余白（.spacer）を一緒に置く
 */
export function HomeFooter({ current }: { current: Tab }) {
  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
      <nav className={styles.footer} aria-label={t('画面の切り替え', 'Main navigation')}>
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          to={tab.to}
          replace
          className={tab.id === current ? `${styles.tab} ${styles.current}` : styles.tab}
          aria-current={tab.id === current ? 'page' : undefined}
          onClick={(event) => {
            if (tab.id !== current && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) playSound('select')
          }}
        >
          <span className={styles.icon}>
            <Icon name={tab.icon} size={24} />
          </span>
          {tab.label}
        </Link>
      ))}
      </nav>
    </>
  )
}
