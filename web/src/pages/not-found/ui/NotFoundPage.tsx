import { translate as t } from '@/shared/lib'
import { ButtonLink, Screen } from '@/shared/ui'

/** 知らない URL を開いたとき */
export function NotFoundPage() {
  return (
    <Screen>
      <h1>{t('ページが見つかりません', 'Page not found')}</h1>
      <p>{t('URL が途中で切れているかもしれません。招待リンクなら、送ってくれた人に確かめてください。', 'The URL may be incomplete. If it was an invite link, ask the sender to check it.')}</p>
      <ButtonLink to="/" variant="go" block>
        {t('ホームへ', 'Back to home')}
      </ButtonLink>
    </Screen>
  )
}
