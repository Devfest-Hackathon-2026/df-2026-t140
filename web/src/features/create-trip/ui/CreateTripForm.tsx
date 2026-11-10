import { MEMBER_NAME_MAX } from '@/entities/member'
import { TripInfoFields } from '@/entities/trip'
import { Button, ErrorText, Field, Icon, TextInput } from '@/shared/ui'
import { useCreateTrip } from '../model/useCreateTrip'
import styles from './CreateTripForm.module.css'

interface Props {
  /** 作れたら、旅の ID を渡して呼ぶ */
  onCreated: (tripId: string) => void
}

/** 旅をつくる入力（S01）。タイトル・日程・出発地と、みんなに見える自分の名前 */
export function CreateTripForm({ onCreated }: Props) {
  const { info, setInfo, name, setName, problem, sending, submit } = useCreateTrip(onCreated)

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <TripInfoFields value={info} onChange={setInfo} />
      <Field label="あなたの名前" hint="みんなのマップに出る名前です。ログインは要りません。">
        <TextInput
          name="displayName"
          value={name}
          maxLength={MEMBER_NAME_MAX}
          placeholder="例：ゆう"
          autoComplete="nickname"
          enterKeyHint="done"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <ErrorText>{problem}</ErrorText>
      <Button type="submit" variant="go" size="large" block disabled={sending}>
        <Icon name="map" />
        {sending ? '作っています…' : '旅を計画する'}
      </Button>
    </form>
  )
}
