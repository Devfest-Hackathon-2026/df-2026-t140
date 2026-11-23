import { translate as t } from '@/shared/lib'
import { useState } from 'react'
import { changeOrigin } from '@/entities/trip'
import { useSession } from '@/shared/api'
import { useToast } from '@/shared/ui'

export function useEditOrigin(tripId: string, origin: string) {
  const session = useSession()
  const toast = useToast()
  const [name, setName] = useState(origin)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [expectedOrigin, setExpectedOrigin] = useState(origin)

  function open() { setName(origin); setExpectedOrigin(origin); setProblem(null); setEditing(true) }
  async function save() {
    if (saving) return
    if (!name.trim() || name.trim().length > 40) { setProblem(t('出発地を40文字以内で入れてください。', 'Enter a departure point of up to 40 characters.')); return }
    setSaving(true)
    setProblem(null)
    try {
      await changeOrigin(session, tripId, name.trim(), expectedOrigin)
      setEditing(false)
      toast(t('出発地を変更しました', 'Departure point updated'))
    } catch (cause) {
      setProblem(cause instanceof Error && !('code' in cause) ? cause.message : t('出発地を変えられませんでした。もう一度試してください。', 'Could not change the departure point. Try again.'))
    } finally { setSaving(false) }
  }
  return { name, setName, editing, saving, problem, open, close: () => setEditing(false), save }
}
