import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(4000),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_TEST: z.string().min(1).optional(),

  // Auth
  JWT_SECRET: z.string().min(32, "invalid_length"),
  JWT_REFRESH_SECRET: z.string().min(32, "invalid_length"),

  // Encryption
  ENCRYPTION_KEY: z.string().length(32, "invalid_length"),

  // Redis
  REDIS_URL: z.string().min(1),

  // CORS
  CORS_ORIGIN: z.string().url(),

  // S3 Storage (optional — required in production)
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_BUCKET_NAME: z.string().optional(),

  // AI
  GEMINI_API_KEY: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM:     z.string().optional(),
  EMAIL_TO:       z.string().optional(),

  // SMS (optional — configured via admin panel after launch)
  SMS_PROVIDER: z.enum(["unifonic", "twilio"]).optional(),
  SMS_API_KEY: z.string().optional(),    // Unifonic: AppSid | Twilio: AccountSid
  SMS_API_SECRET: z.string().optional(), // Twilio only: AuthToken
  SMS_SENDER_ID: z.string().optional(),  // Unifonic: SenderID | Twilio: from-number

  // Payment gateways (optional — configured per environment)
  ZAINCASH_MERCHANT_ID: z.string().optional(),
  ZAINCASH_SECRET: z.string().optional(),
  FIB_CLIENT_ID: z.string().optional(),
  FIB_CLIENT_SECRET: z.string().optional(),
  PAYTABS_PROFILE_ID: z.string().optional(),
  PAYTABS_SERVER_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(
  raw: Record<string, string | undefined> = process.env,
): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    throw new Error(
      `Invalid environment variables:\n${JSON.stringify(errors, null, 2)}`,
    );
  }
  return result.data;
}

// In test mode, modules import validateEnv() directly — no auto-execution needed.
// In all other environments, validate immediately and crash hard on missing vars.
let _env: Env = {} as Env;

if (process.env["NODE_ENV"] !== "test") {
  try {
    _env = validateEnv();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

export const env = _env;
