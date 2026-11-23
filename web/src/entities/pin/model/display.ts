import { appLanguage } from '../../../shared/lib/language.ts'
import type { Pin } from './types'

export function pinDisplayName(pin: Pick<Pin, 'name' | 'nameEn'>): string {
  return appLanguage === 'en' ? pin.nameEn || pin.name : pin.name
}

export function pinDisplayDescription(pin: Pick<Pin, 'description' | 'descriptionEn'>): string {
  return appLanguage === 'en' ? pin.descriptionEn || pin.description : pin.description
}

export function pinDisplayArea(pin: Pick<Pin, 'area' | 'areaEn'>): string {
  return appLanguage === 'en' ? pin.areaEn || pin.area : pin.area
}
