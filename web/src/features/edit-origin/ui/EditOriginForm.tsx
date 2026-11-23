import { translate as t } from '@/shared/lib'
import { Button, ErrorText, Field, TextInput } from '@/shared/ui'
import { useEditOrigin } from '../model/useEditOrigin'
import styles from './EditOriginForm.module.css'

export function EditOriginForm({ tripId, origin }: { tripId: string; origin: string }) {
  const form = useEditOrigin(tripId, origin)
  if (!form.editing) return <Button block onClick={form.open}>{t('出発地を変更する', 'Change departure point')}</Button>
  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void form.save() }}>
      <Field label={t('出発地（集合場所）', 'Departure point (meeting place)')}>
        <TextInput value={form.name} maxLength={40} autoFocus disabled={form.saving} onChange={(event) => form.setName(event.target.value)} />
      </Field>
      <ErrorText>{form.problem}</ErrorText>
      <div className={styles.actions}>
        <Button disabled={form.saving} onClick={form.close}>{t('やめる', 'Cancel')}</Button>
        <Button type="submit" variant="go" disabled={form.saving}>{form.saving ? t('調べています…', 'Looking up…') : t('この出発地にする', 'Save departure point')}</Button>
      </div>
    </form>
  )
}
