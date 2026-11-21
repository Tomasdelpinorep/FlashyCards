// Starts the dedicated e2e dev server (Playwright `webServer`).
//
// 1. Wipes the isolated local D1 state (.wrangler/e2e-state) and applies every migration to it
//    with the e2e wrangler config. This runs here and not in a Playwright globalSetup because
//    Playwright starts the webServer BEFORE globalSetup, and the state must be fresh before the
//    Worker opens it.
// 2. Runs Vite with E2E=1 (vite.config.ts then uses e2e/wrangler.e2e.jsonc and the e2e state
//    dir, no HMR socket, no inspector port) on 127.0.0.1:5180.
//
// Playwright stops it with `taskkill /T /F` (Windows) or SIGTERM, which takes down the whole tree
// (this script, Vite and workerd).
import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const E2E_PORT = Number(process.env.E2E_PORT ?? 5180)
const STATE_DIR = '.wrangler/e2e-state'

rmSync(new URL(`../${STATE_DIR}`, import.meta.url), { recursive: true, force: true })

const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_D1_WARNING: 'true' }
const migrate = spawnSync(
  process.execPath,
  ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'e2e/wrangler.e2e.jsonc', '--persist-to', STATE_DIR],
  { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] },
)
if (migrate.status !== 0) {
  console.error(`e2e: migrations failed (exit ${migrate.status})`)
  process.exit(1)
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(E2E_PORT), '--strictPort'], {
  cwd: root,
  env: { ...env, E2E: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
})
vite.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => vite.kill(sig))
