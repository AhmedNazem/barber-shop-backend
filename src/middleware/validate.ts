import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

type Target = 'body' | 'query' | 'params'

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target])
    if (!result.success) {
      res.status(400).json({
        error: 'validation_error',
        errors: result.error.flatten().fieldErrors,
      })
      return
    }
    req[target] = result.data
    next()
  }
}
