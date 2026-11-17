import { hc } from 'hono/client'
import type { ApiError as ApiErrorBody } from '../../shared/schemas'
import type { AppType } from '../../worker/index'

/** Typed Hono RPC client. Same-origin; Cloudflare Access cookies are sent automatically. */
export const api = hc<AppType>('/').api

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`)
  }
}

/** Await an RPC call and return its JSON body as `T`, or throw ApiError for non-2xx responses. */
export async function unwrap<T>(call: Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): Promise<T> {
  const res = await call
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody | null)
  return body as T
}
