import winston from 'winston'

const REDACTED = '[REDACTED]'
const SENSITIVE_KEYS = new Set([
  'authorization', 'password', 'otp', 'apikey',
  'smsapikey', 'cardnumber', 'cvv', 'token', 'secret',
])

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1)
  }
  return result
}

const redactFormat = winston.format((info) => {
  if (info['meta']) info['meta'] = redact(info['meta'])
  return info
})

export const logger = winston.createLogger({
  level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'debug',
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    process.env['NODE_ENV'] === 'production'
      ? winston.format.json()
      : winston.format.colorize({ all: true }),
    process.env['NODE_ENV'] !== 'production'
      ? winston.format.simple()
      : winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
})
