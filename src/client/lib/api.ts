import { hc } from 'hono/client'
import type { AppType } from '../../worker/index'

/** Typed Hono RPC client. Same-origin; Cloudflare Access cookies are sent automatically. */
export const api = hc<AppType>('/').api
