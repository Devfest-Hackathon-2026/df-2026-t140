import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 2 組目の Emulator（npm run dev:alt）では、ポートを全部この数だけずらす（scripts/dev-alt.mjs）
const offset = Number(process.env.EMULATOR_PORT_OFFSET ?? 0)
// 5173 で開いたまま 2 組目の Emulator につなぐとき（本物の地図で撮るとき。web/src/shared/api/connect.ts）
const emulatorOffset = Number(process.env.VITE_EMULATOR_PORT_OFFSET || offset)

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
    port: 5173 + offset,
    strictPort: offset > 0,
    // Firebase の設定は本番と同じ経路で Hosting Emulator から読む
    proxy: { '/__': `http://127.0.0.1:${5002 + emulatorOffset}` },
  },
})
