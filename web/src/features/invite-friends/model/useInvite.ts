import { useEffect, useState } from 'react'
import { issueJoinCode } from '@/entities/trip'
import { useSession } from '@/shared/api'
import { translate, copyText, playSound, prepareSounds } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { inviteUrl } from '../lib/inviteUrl'

/**
 * 招待リンクと旅の合言葉、合言葉をコピーする・OS の共有の画面で送る操作。
 * tripJoinCode は旅に入っている合言葉。ふつうは旅を作った直後に頼み始めているので（features/create-trip）、もう入っているか、すぐ届く。
 * まだなければ、ここでも頼む（頼んでいる途中なら同じ結果を待つ。前からある旅にも、招待の画面を開いたときに合言葉が付く）。
 */
export function useInvite(tripId: string, tripTitle: string, tripJoinCode: string | undefined) {
  const session = useSession()
  const toast = useToast()
  const url = inviteUrl(tripId)
  const [issued, setIssued] = useState<{ tripId: string; joinCode: string | null }>()

  useEffect(() => {
    if (tripJoinCode) return
    let cancelled = false
    issueJoinCode(session, tripId).then(
      (joinCode) => !cancelled && setIssued({ tripId, joinCode }),
      (cause: unknown) => {
        // 作れなくても、招待リンクで招待できる。合言葉の欄を出さないだけにする
        console.error(cause)
        if (!cancelled) setIssued({ tripId, joinCode: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [session, tripId, tripJoinCode])

  // undefined は作っている途中、null は作れなかった
  const joinCode = tripJoinCode ?? (issued?.tripId === tripId ? issued.joinCode : undefined)

  async function copy() {
    prepareSounds()
    const copied = await copyText(url)
    playSound(copied ? 'confirm' : 'error')
    toast(copied
      ? translate('招待リンクをコピーしました', 'Invitation link copied.')
      : translate('コピーできませんでした。合言葉か QR コードで招待してください', 'Could not copy the link. Share the trip code or QR code instead.'))
  }

  async function copyJoinCode() {
    if (!joinCode) return
    prepareSounds()
    const copied = await copyText(joinCode)
    playSound(copied ? 'confirm' : 'error')
    toast(copied ? translate('旅の合言葉をコピーしました', "Trip code copied.") : translate('コピーできませんでした。合言葉を長押ししてコピーしてください', "Couldn't copy the code. Press and hold it to copy."))
  }

  async function share() {
    // 共有シートのない環境（パソコンのブラウザなど）では、コピーで代える
    if (!navigator.share) return copy()
    const invitation = translate(`「${tripTitle}」を一緒に計画しよう！`, `Help plan “${tripTitle}”!`)
    const text = joinCode ? translate(`${invitation}旅の合言葉は ${joinCode} です。`, `${invitation} The trip code is ${joinCode}.`) : invitation
    try {
      await navigator.share({ title: tripTitle, text, url })
    } catch {
      // 共有をやめただけなので、何もしない
    }
  }

  return { url, joinCode, copyJoinCode, share }
}
