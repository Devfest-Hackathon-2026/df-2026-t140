import { copyText, playSound, prepareSounds } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { inviteUrl } from '../lib/inviteUrl'

/** 招待リンクと、それをコピーする・アプリで共有する操作 */
export function useInvite(tripId: string, tripTitle: string) {
  const toast = useToast()
  const url = inviteUrl(tripId)

  async function copy() {
    prepareSounds()
    const copied = await copyText(url)
    playSound(copied ? 'confirm' : 'error')
    toast(copied ? '招待リンクをコピーしました' : 'コピーできませんでした。リンクを長押ししてコピーしてください')
  }

  async function share() {
    // 共有シートのない環境（パソコンのブラウザなど）では、コピーで代える
    if (!navigator.share) return copy()
    try {
      await navigator.share({ title: tripTitle, text: `「${tripTitle}」を一緒に計画しよう！`, url })
    } catch {
      // 共有をやめただけなので、何もしない
    }
  }

  return { url, copy, share }
}
