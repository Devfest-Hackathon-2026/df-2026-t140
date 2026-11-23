import { useEffect, useState } from 'react'
import {
  type Account,
  accountOf,
  isLocal,
  linkGoogle,
  logout as logoutAccount,
  noteLinkOutcome,
  subscribeAccount,
  useSession,
} from '@/shared/api'
import { playSound, prepareSounds, translate as t } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { errorCode, linkProblem } from './linkProblem'

/**
 * Google アカウントとの連携の状態と、連携する・ログアウトする操作。
 * 連携は任意で、しなくても名前だけで使える。
 * 連携済みの Google アカウントでログインすると別の人（uid）に切り替わるので、ページを読み込み直す
 * （その端末で名前だけで参加していた旅は、切り替える前に今の自分へ引き継がれる。shared/api/account.ts）。
 * 読み込み直したあとの知らせは、useLinkOutcomeNotice が出す。
 */
export function useGoogleLink() {
  const session = useSession()
  const toast = useToast()
  const [account, setAccount] = useState<Account>(() => accountOf(session.auth.currentUser))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => subscribeAccount(session.auth, setAccount), [session])

  async function link() {
    prepareSounds()
    setBusy(true)
    setProblem(null)
    try {
      const outcome = await linkGoogle(session.auth, session.functions, isLocal)
      if (outcome === 'linked') {
        playSound('confirm')
        setAccount(accountOf(session.auth.currentUser))
        toast(t('Google アカウントと連携しました', 'Google account connected'))
      }
      if (outcome === 'switched') {
        noteLinkOutcome({ kind: 'switched' })
        location.reload()
        return
      }
      // ログインの画面へ移るあいだは、押せないままにする
      if (outcome === 'redirecting') return
    } catch (cause) {
      console.error(cause)
      playSound('error')
      setProblem(linkProblem(errorCode(cause)))
    }
    setBusy(false)
  }

  async function logout() {
    setBusy(true)
    try {
      await logoutAccount(session.auth)
      location.reload()
    } catch (cause) {
      console.error(cause)
      setProblem(t('ログアウトできませんでした。もう一度押してください。', 'Could not sign out. Try again.'))
      setBusy(false)
    }
  }

  return { account, busy, problem, link, logout }
}
