import { translate } from '@/shared/lib'
import { TravelModeChoice, type TravelMode } from '@/entities/trip'
import { useChangeTravelMode } from '../model/useChangeTravelMode'

interface Props {
  tripId: string
  mode: TravelMode
  /** 旅程が確定していて、選び直せない（features/confirm-shiori） */
  locked?: boolean
}

/** しおり（S11）としおりビュー（S14）の、おもな移動の切り替え。押すと、しおりの時刻を選んだ移動で組み直す */
export function TravelModeSwitch({ tripId, mode, locked = false }: Props) {
  const { value, busy, choose } = useChangeTravelMode(tripId, mode)
  return <TravelModeChoice value={value} onChange={(next) => void choose(next)} label={translate('おもな移動', "Main travel mode")} disabled={busy || locked} compact />
}
