import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // 層をまたぐ import は @/<層>/<スライス> と書く（docs/architecture/design-principles.md）
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 同じネットワークのスマホからも開けるようにする
    host: true,
    // Firebase の設定は本番と同じ経路で Hosting Emulator から読む
    proxy: { '/__': 'http://127.0.0.1:5002' },
  },
})
