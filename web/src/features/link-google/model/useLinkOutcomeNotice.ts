import { translate as t } from '@/shared/lib'
import { useEffect } from 'react'
import { clearLinkOutcome, readLinkOutcome } from '@/shared/api'
import { useToast } from '@/shared/ui'
import { linkProblem } from './linkProblem'

/**
 * 読み込み直す前（ログインの画面から戻ってくる前）に覚えておいた連携の結果を、1 回だけ知らせる。
 * ログインのボタンを置いた画面（ホーム、旅の入口）で呼ぶ。連携のカードが出ない画面
 * （ログインしたらメンバーだったので、そのまま旅が開いたとき）でも、その場で知らせるため
 */
export function useLinkOutcomeNotice(): void {
  const toast = useToast()
  useEffect(() => {
    const outcome = readLinkOutcome()
    clearLinkOutcome()
    if (outcome?.kind === 'linked') toast(t('Google アカウントと連携しました', 'Google account connected'))
    if (outcome?.kind === 'switched') toast(t('Google アカウントでログインしました', 'Signed in with Google'))
    if (outcome?.kind === 'failed') toast(linkProblem(outcome.code))
  }, [toast])
}
