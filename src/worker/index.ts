import { Hono } from 'hono'
import type { AppEnv } from './env'

const app = new Hono<AppEnv>().basePath('/api')

app.get('/health', (c) => c.json({ ok: true as const, time: new Date().toISOString() }))

export type AppType = typeof app
export default app
