import { MEMBER_NAME_MAX } from '@/entities/member'
import { Button, ErrorText, TextInput } from '@/shared/ui'
import { useEditMyName } from '../model/useEditMyName'
import styles from './EditMyNameForm.module.css'

interface Props {
  tripId: string
  currentName: string
  onDone: () => void
}

/** この旅での自分の表示名を直す */
export function EditMyNameForm({ tripId, currentName, onDone }: Props) {
  const { name, setName, problem, submit } = useEditMyName(tripId, currentName, onDone)

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <TextInput
        name="displayName"
        aria-label="あなたの名前"
        value={name}
        maxLength={MEMBER_NAME_MAX}
        autoComplete="nickname"
        enterKeyHint="done"
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" variant="go">
        保存
      </Button>
      <div className={styles.error}>
        <ErrorText>{problem}</ErrorText>
      </div>
    </form>
  )
}
