import { zValidator } from '@hono/zod-validator'
import type { ErrorHandler, NotFoundHandler, ValidationTargets } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ZodType } from 'zod'

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) return c.json({ error: 'http_error', message: err.message }, err.status)
  console.error('unhandled error', err)
  return c.json({ error: 'internal_error' }, 500)
}

export const notFound: NotFoundHandler = (c) => c.json({ error: 'not_found' }, 404)

/** zValidator with a uniform 400 body: `{ error: 'invalid_request', issues }`. */
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(target: Target, schema: Schema) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json({ error: 'invalid_request', issues: result.error.issues }, 400)
  })
