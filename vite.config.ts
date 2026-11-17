import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  // The SPA lives in src/client (PLAN.md section 7); the Worker config stays at the repo root.
  root: r('./src/client'),
  publicDir: r('./public'),
  build: { outDir: r('./dist'), emptyOutDir: true },
  plugins: [react(), tailwindcss(), cloudflare({
      configPath: r('./wrangler.jsonc'),
      // Keep local D1/KV state at the repo root (where `wrangler d1 migrations apply --local`
      // writes it) instead of the default <vite root>/.wrangler, i.e. src/client/.wrangler.
      persistState: { path: r('./.wrangler/state') },
    })],
})
