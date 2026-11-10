import { useState } from 'react'
import { Avatar, type Member } from '@/entities/member'
import { EditMyNameForm } from '@/features/edit-my-name'
import { InvitePanel } from '@/features/invite-friends'
import { LeaveTripButton } from '@/features/leave-trip'
import type { WithId } from '@/shared/api'
import { Button, Icon, Sheet } from '@/shared/ui'
import styles from './InviteSheet.module.css'

interface Props {
  tripId: string
  tripTitle: string
  members: WithId<Member>[]
  myUid: string
  /**
   * 「次へ：計画をはじめる」を出すか。旅を作った直後だけ true。
   * すでに旅に入っていて顔のボタンから開いたときは、右上の × と役割が同じなので出さない
   */
  showNext?: boolean
  /** 「次へ：計画をはじめる」や閉じるボタンで呼ぶ */
  onClose: () => void
  /** 旅から抜ける直前に呼ぶ */
  onLeaving: () => void
}

/** 友達を招待するシート（S02）。招待リンク、QR コード、共有と、参加しているメンバー */
export function InviteSheet({ tripId, tripTitle, members, myUid, showNext = false, onClose, onLeaving }: Props) {
  const [renaming, setRenaming] = useState(false)

  return (
    <Sheet
      title="友達を招待しよう"
      lead="招待された人も同じマップで一緒に計画できます。"
      action={
        <Button sound="close" iconOnly variant="text" aria-label="閉じる" onClick={onClose}>
          <Icon name="close" />
        </Button>
      }
    >
      <InvitePanel tripId={tripId} tripTitle={tripTitle} />

      <div className={styles.members}>
        <h3 className={styles.membersTitle}>参加しているメンバー {members.length}人</h3>
        <ul>
          {members.map((member) => (
            <li key={member.id} className={styles.member}>
              <Avatar member={member} size={36} />
              {member.id === myUid && renaming ? (
                <EditMyNameForm tripId={tripId} currentName={member.displayName} onDone={() => setRenaming(false)} />
              ) : (
                <>
                  <span className={styles.name}>
                    {member.displayName}
                    {member.id === myUid && <span className={styles.me}>（あなた）</span>}
                  </span>
                  {member.id === myUid && (
                    <Button sound="open" size="small" onClick={() => setRenaming(true)}>
                      名前を変える
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {showNext && (
        <Button sound="close" variant="go" size="large" block onClick={onClose}>
          次へ：計画をはじめる
        </Button>
      )}
      <div className={styles.footer}>
        <LeaveTripButton tripId={tripId} onLeaving={onLeaving} />
      </div>
    </Sheet>
  )
}
