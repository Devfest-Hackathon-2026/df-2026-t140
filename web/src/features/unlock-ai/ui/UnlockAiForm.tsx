import { translate as t } from '@/shared/lib'
import { Button, ErrorText, TextInput } from '@/shared/ui'
import { PASSPHRASE_MAX, useUnlockAi } from '../model/useUnlockAi'
import styles from './UnlockAiForm.module.css'

interface Props {
  onDone: () => void
}

/** 合言葉を入れて、本物の AI を自分の希望で使えるようにする */
export function UnlockAiForm({ onDone }: Props) {
  const { passphrase, setPassphrase, problem, sending, submit } = useUnlockAi(onDone)

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <TextInput
        name="passphrase"
        type="password"
        aria-label={t('合言葉', 'Passphrase')}
        placeholder={t('合言葉', 'Passphrase')}
        value={passphrase}
        maxLength={PASSPHRASE_MAX}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setPassphrase(event.target.value)}
      />
      <Button type="submit" variant="go" disabled={sending}>
        {t('送る', 'Submit')}
      </Button>
      <div className={styles.error}>
        <ErrorText>{problem}</ErrorText>
      </div>
    </form>
  )
}
