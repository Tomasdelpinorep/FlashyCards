import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// E2E=1 is set only by e2e/server.mjs (npm run test:e2e). It swaps in the e2e Worker config,
// whose folder has no .dev.vars (so the user's ../.dev.vars is never read), and an isolated D1
// state dir that the launcher wipes and re-migrates before every run. See docs/DECISIONS.md M8-QA.
const e2e = process.env.E2E === '1'

export default defineConfig({
  // The SPA lives in src/client (PLAN.md section 7); the Worker config stays at the repo root.
  root: r('./src/client'),
  publicDir: r('./public'),
  build: { outDir: r('./dist'), emptyOutDir: true },
  // No HMR socket in e2e: a dropped socket (context.setOffline) would make Vite reload the page.
  server: e2e ? { hmr: false } : undefined,
  plugins: [react(), tailwindcss(), cloudflare({
      configPath: r(e2e ? './e2e/wrangler.e2e.jsonc' : './wrangler.jsonc'),
      // Keep local D1/KV state at the repo root (where `wrangler d1 migrations apply --local`
      // writes it) instead of the default <vite root>/.wrangler, i.e. src/client/.wrangler.
      persistState: { path: r(e2e ? './.wrangler/e2e-state' : './.wrangler/state') },
      // Don't take the inspector port of a dev server the user may have running.
      ...(e2e ? { inspectorPort: false as const } : {}),
    })],
})
