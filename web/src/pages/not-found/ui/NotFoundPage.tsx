import { ButtonLink, Screen } from '@/shared/ui'

/** 知らない URL を開いたとき */
export function NotFoundPage() {
  return (
    <Screen>
      <h1>ページが見つかりません</h1>
      <p>URL が途中で切れているかもしれません。招待リンクなら、送ってくれた人に確かめてください。</p>
      <ButtonLink to="/" variant="go" block>
        ホームへ
      </ButtonLink>
    </Screen>
  )
}
