import { appLanguage, setAppLanguage } from '@/shared/lib'
import { Button } from './Button'

export function LanguageSwitcher() {
  const target = appLanguage === 'en' ? 'ja' : 'en'
  return (
    <Button size="small" lang={target} onClick={() => setAppLanguage(target)}>
      {target === 'en' ? 'English' : '日本語'}
    </Button>
  )
}
