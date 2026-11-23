import { useEffect, useState } from 'react'
import { type ShioriBook, shioriBookDays } from '@/entities/trip'
import {
  accountOf,
  forgetGoogleCalendarToken,
  isLocal,
  noteLinkOutcome,
  requestGoogleCalendarAccess,
  takeGoogleCalendarToken,
  useSession,
} from '@/shared/api'
import { translate, playSound, prepareSounds } from '@/shared/lib'
import { useToast } from '@/shared/ui'
import { CalendarProblem, insertCalendarEvents } from '../api/calendar'
import { calendarDayUrl, calendarEvents, eventsByDate } from '../lib/events'
import { forgetPendingExport, pendingExportTrip, rememberPendingExport } from '../lib/pending'

/**
 * カレンダーに入れる画面の状態。
 * closed：出していない。review：入れる予定を見せて、押すのを待つ。sending：入れている（done 件まで）。
 * sent：入れ終えた。failed：入れられなかった（retry なら、この画面でもう一度押せる。
 * 許可が切れた・ないときは、持っているトークンでは入れられないので、閉じて Google の許可からやり直す）
 */
export type CalendarPhase =
  | { kind: 'closed' }
  | { kind: 'review'; token: string }
  | { kind: 'sending'; token: string; done: number }
  | { kind: 'sent' }
  | { kind: 'failed'; token: string; message: string; retry: boolean }

const PROBLEMS: Record<CalendarProblem['reason'], string> = {
  expired: translate('Google の許可が切れました。閉じてから、もう一度「Google カレンダーに入れる」を押してください。', "Google access expired. Close this dialog and select Add to Google Calendar again."),
  denied: translate('Google カレンダーに入れる許可がありません。閉じてから、もう一度押して、カレンダーの許可にチェックを入れてください。', "Calendar permission is required. Close this dialog, try again, and grant access to Google Calendar."),
  failed: translate('Google カレンダーに入れられませんでした。もう一度試してください。', "Couldn't add the events to Google Calendar. Try again."),
}

/** Google のポップアップが失敗したときのお知らせ */
function accessProblem(cause: unknown): string {
  const code = (cause as { code?: string } | null)?.code
  if (code === 'auth/user-mismatch') return translate('Google カレンダーには、連携している Google アカウントを選んでください', "Select the Google account linked to this app.")
  if (code === 'auth/popup-blocked') return translate('ポップアップが止められました。ブラウザでポップアップを許可してください', "Your browser blocked the pop-up. Allow pop-ups and try again.")
  return translate('Google のログインができませんでした。もう一度試してください', "Couldn't sign in to Google. Try again.")
}

/**
 * しおりを、押した人の Google カレンダーに入れる操作（企画書「ユーザー体験」3-6）。
 * start で Google のポップアップを出し、カレンダーの許可（連携していなければ連携も）をもらってから、入れる予定を見せる。
 * ログインの画面へ移った・アカウントを切り替えて読み込み直したときは、戻ってきたこの画面で続きを出す。
 * 手元（Emulator）では本物のトークンがないので、Calendar API を呼ばずに見本として進める
 */
export function useCalendarExport(tripId: string, book: ShioriBook | undefined) {
  const session = useSession()
  const toast = useToast()
  // 戻ってきたところなら、受け取ったトークンで続きを出す（印を消すのは、描いたあとの効果で行う）
  const [phase, setPhase] = useState<CalendarPhase>(() => {
    const token = pendingExportTrip() === tripId ? takeGoogleCalendarToken() : null
    return token ? { kind: 'review', token } : { kind: 'closed' }
  })
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (pendingExportTrip() === tripId) forgetPendingExport()
  }, [tripId])

  const events = book ? calendarEvents(shioriBookDays(book), book.title, tripId) : []
  const days = eventsByDate(events)

  async function start(): Promise<void> {
    if (asking || !book) return
    prepareSounds()
    setAsking(true)
    // 画面ごとログインへ移る・切り替えて読み込み直すときのために、先に覚えておく
    rememberPendingExport(tripId)
    try {
      const access = await requestGoogleCalendarAccess(session.auth, session.functions, isLocal)
      if (access.kind === 'redirecting') return
      if (access.kind === 'switched') {
        noteLinkOutcome({ kind: 'switched' })
        location.reload()
        return
      }
      forgetPendingExport()
      if (access.kind === 'ready') {
        playSound('open')
        setPhase({ kind: 'review', token: access.token })
      }
    } catch (cause) {
      console.error(cause)
      forgetPendingExport()
      playSound('error')
      toast(accessProblem(cause))
    }
    setAsking(false)
  }

  async function send(): Promise<void> {
    if (phase.kind !== 'review' && !(phase.kind === 'failed' && phase.retry)) return
    const { token } = phase
    setPhase({ kind: 'sending', token, done: 0 })
    try {
      await insertCalendarEvents(token, events, (done) => setPhase({ kind: 'sending', token, done }), isLocal)
      playSound('build-complete')
      setPhase({ kind: 'sent' })
    } catch (cause) {
      console.error(cause)
      const reason = cause instanceof CalendarProblem ? cause.reason : 'failed'
      // 許可が切れた・ないときは、次に押したときに Google のポップアップを出し直す
      if (reason !== 'failed') forgetGoogleCalendarToken()
      playSound('error')
      setPhase({ kind: 'failed', token, message: PROBLEMS[reason], retry: reason === 'failed' })
    }
  }

  function close(): void {
    if (phase.kind === 'sending') return
    playSound('close')
    setPhase({ kind: 'closed' })
  }

  return {
    phase,
    asking,
    events,
    /** 予定を日ごとに分けたもの（画面に並べる） */
    days,
    /** 入れ終えたあとに開く、最初の日の Google カレンダー */
    calendarUrl: days[0] ? calendarDayUrl(days[0].date) : null,
    email: accountOf(session.auth.currentUser).email,
    /** 手元の見本か（本物のカレンダーには入れない） */
    sample: isLocal,
    start,
    send,
    close,
  }
}
