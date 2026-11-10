import { MEMBER_NAME_MAX } from '@/entities/member'
import { Button, ErrorText, Field, TextInput } from '@/shared/ui'
import { useJoinTrip } from '../model/useJoinTrip'
import styles from './JoinTripForm.module.css'

interface Props {
  tripId: string
}

/** 招待 URL を開いた人が、表示名を入れて参加する入力 */
export function JoinTripForm({ tripId }: Props) {
  const { name, setName, problem, sending, submit } = useJoinTrip(tripId)

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <Field label="あなたの名前" hint="みんなのマップに出る名前です。ログインは要りません。">
        <TextInput
          name="displayName"
          value={name}
          maxLength={MEMBER_NAME_MAX}
          placeholder="例：みお"
          autoComplete="nickname"
          enterKeyHint="done"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <ErrorText>{problem}</ErrorText>
      <Button type="submit" variant="go" size="large" block disabled={sending}>
        {sending ? '参加しています…' : 'この旅に参加する'}
      </Button>
    </form>
  )
}
