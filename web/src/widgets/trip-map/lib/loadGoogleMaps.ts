// Maps JavaScript API を読み込む。読み込むのは 1 回だけ。
//
// 使うのは地図の表示（maps）とマーカー（marker）だけ。Places、Routes、3D 地図、オートコンプリート、
// 写真は読み込まない（1 日の上限が 0 回か、あとの段のために取ってある。docs/process/setup.md）。

const CALLBACK = '__konbuMapsReady'
const TIMEOUT_MS = 15_000

type AuthFailureListener = () => void
const authFailureListeners = new Set<AuthFailureListener>()

declare global {
  interface Window {
    [CALLBACK]?: () => void
    /** キーが使えないとき（リファラの制限、上限など）に Maps が呼ぶ */
    gm_authFailure?: () => void
  }
}

let loading: Promise<typeof google.maps> | undefined

export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  loading ??= new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('地図の読み込みに時間がかかりすぎました')), TIMEOUT_MS)
    window[CALLBACK] = () => {
      clearTimeout(timer)
      resolve(google.maps)
    }
    window.gm_authFailure = () => {
      clearTimeout(timer)
      reject(new Error('地図のキーが使えません'))
      authFailureListeners.forEach((listener) => listener())
    }

    const params = new URLSearchParams({
      key: apiKey,
      v: 'quarterly',
      loading: 'async',
      libraries: 'maps,marker',
      language: 'ja',
      region: 'JP',
      callback: CALLBACK,
    })
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => {
      clearTimeout(timer)
      reject(new Error('地図を読み込めませんでした'))
    }
    document.head.append(script)
  })
  return loading
}

/** 読み込んだあとでキーが使えないと分かったときに呼ばれる。返り値の関数でやめる */
export function onGoogleMapsAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener)
  return () => authFailureListeners.delete(listener)
}
