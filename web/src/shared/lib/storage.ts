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

/** 名前が prefix で始まる、覚えた値をすべて読む（古い形で覚えたものを拾い直すとき用） */
export function recallAll(prefix: string): string[] {
  try {
    const full = keyOf(prefix)
    const values: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      const value = key?.startsWith(full) ? localStorage.getItem(key) : null
      if (value !== null) values.push(value)
    }
    return values
  } catch {
    return []
  }
}
