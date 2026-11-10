// この端末だけに覚えておく小さな値。使えない環境（プライベートブラウズなど）では、覚えないだけで動く。
// 複数人シミュレーションの中の画面では、画面ごとに置き場を分ける（simFrame.ts）。
import { simFrame } from './simFrame'

const keyOf = (key: string) => `${simFrame?.storagePrefix ?? ''}${key}`

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(keyOf(key), value)
  } catch {
    // 覚えられなくても困らない
  }
}

export function recall(key: string): string | null {
  try {
    return localStorage.getItem(keyOf(key))
  } catch {
    return null
  }
}
