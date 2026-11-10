import { ButtonLink } from './Button'
import { Icon } from './Icon'

/** どの画面にも置く、ホーム（旅の一覧）へ戻るボタン */
export function HomeButton() {
  return (
    <ButtonLink to="/" sound="close" iconOnly aria-label="ホーム（旅の一覧）へ">
      <Icon name="home" />
    </ButtonLink>
  )
}
