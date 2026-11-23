import { translate as t } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import { useTutorialReplay } from '../model/useTutorialGate'
import { Tutorial } from './Tutorial'

/** チュートリアルを見返すボタン（ホームに置く）。押すと、最初の 1 枚から出す */
export function TutorialButton() {
  const { open, show, close } = useTutorialReplay()
  return (
    <>
      <Button variant="soft" block sound="open" onClick={show}>
        <Icon name="play" />
        {t('使い方を見る', 'See how it works')}
      </Button>
      {open && <Tutorial onClose={close} />}
    </>
  )
}
