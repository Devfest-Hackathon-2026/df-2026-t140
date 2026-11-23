import { useState } from 'react'
import { useSession } from '@/shared/api'
import { playSound, prepareSounds, translate } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { dismissFiller, includeFiller } from '../api/fillers'

/** Functions が断ったときのコード。この 4 つは、Functions が書いた理由の文をそのまま出す（features/build-model と同じ） */
const REFUSED = ['functions/resource-exhausted', 'functions/failed-precondition', 'functions/permission-denied', 'functions/not-found']

/**
 * しおりの空いた時間への提案を「入れる」「無視」する操作（#520）。メンバーなら誰でも、1 人の操作で決まる（Takana の決定、2026-11-21）。
 * 入れた提案は建物になってしおりに入り、取り消すときは建物を消す。頼んでいるあいだは、その提案のボタンを押せなくする
 */
export function useFillers(tripId: string) {
  const session = useSession()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function include(pinId: string, name: string): Promise<void> {
    if (busyId) return
    prepareSounds()
    playSound('build-press')
    setBusyId(pinId)
    try {
      await includeFiller(session, tripId, pinId)
      toast(translate(`${name}を建てています。建つと、しおりに入ります`, `Building ${name}. It will appear in the itinerary when ready.`))
    } catch (cause) {
      playSound('error')
      const { code, message } = cause as { code?: string; message?: string }
      const generic = translate('入れられませんでした。電波のよいところで、もう一度押してください', "Couldn't add this suggestion. Check your connection and try again.")
      toast(code && REFUSED.includes(code) && message ? translate(message, "This suggestion can't be added right now.") : generic)
    } finally {
      setBusyId(null)
    }
  }

  async function dismiss(pinId: string): Promise<void> {
    if (busyId) return
    prepareSounds()
    setBusyId(pinId)
    try {
      await dismissFiller(session, tripId, pinId)
      playSound('close')
    } catch {
      playSound('error')
      toast(translate('提案を消せませんでした。もう一度押してください', "Couldn't dismiss the suggestion. Try again."))
    } finally {
      setBusyId(null)
    }
  }

  return { include, dismiss, busyId }
}
