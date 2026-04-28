import { env } from "@/config/env";
import { logger } from "@/lib/logger";

/**
 * Normalise an Iraqi mobile number to E.164 (+9647XXXXXXXXX).
 * Accepts: 07XXXXXXXX | 7XXXXXXXX | +9647XXXXXXXX
 * Throws if the number can't be normalised (caller should validate beforehand).
 */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("9647") && digits.length === 13) return `+${digits}`;
  if (digits.startsWith("07") && digits.length === 11) return `+964${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 10) return `+964${digits}`;

  throw new Error(`Cannot normalise phone number: ${phone}`);
}

/**
 * Send an SMS/WhatsApp message.
 * In dev or without SMS_API_KEY configured → logs to console only.
 * In production with credentials → calls the configured provider and throws on failure.
 */
export async function sendSms(phone: string, message: string): Promise<void> {
  const e164 = normalisePhone(phone);

  // If no API key is provided, fallback to console logging (useful for local dev without Twilio)
  if (!env.SMS_API_KEY) {
    logger.info(`[SMS DEV] To: ${e164} | ${message}`);
    return;
  }

  if (env.SMS_PROVIDER === "unifonic") {
    await sendUnifonic(e164, message);
  } else if (env.SMS_PROVIDER === "twilio") {
    await sendTwilio(e164, message);
  } else {
    // Production with API key but no provider set — hard fail so misconfiguration is visible
    throw new Error("[SMS] SMS_PROVIDER is not configured");
  }
}

// ─── Unifonic ─────────────────────────────────────────────────────────────────

interface UnifonicResponse {
  Success: boolean;
  ErrorCode: string;
  ErrorMessage: string;
  data?: { MessageID: string };
}

async function sendUnifonic(e164: string, message: string): Promise<void> {
  const resp = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      AppSid: env.SMS_API_KEY!,
      SenderID: env.SMS_SENDER_ID ?? "BarberOS",
      Body: message,
      Recipient: e164,
      responseType: "JSON",
    }),
  });

  let body: UnifonicResponse;
  try {
    body = (await resp.json()) as UnifonicResponse;
  } catch {
    throw new Error(`[SMS] Unifonic returned non-JSON (HTTP ${resp.status})`);
  }

  if (!resp.ok || !body.Success) {
    throw new Error(
      `[SMS] Unifonic error ${body.ErrorCode}: ${body.ErrorMessage}`,
    );
  }

  logger.info(`[SMS] Unifonic sent to ${e164} — MessageID: ${body.data?.MessageID}`);
}

// ─── Twilio ───────────────────────────────────────────────────────────────────

interface TwilioResponse {
  sid?: string;
  status?: string;
  error_code?: number | null;
  error_message?: string | null;
  message?: string; // error description when HTTP 4xx/5xx
}

async function sendTwilio(e164: string, message: string): Promise<void> {
  if (!env.SMS_API_SECRET || !env.SMS_SENDER_ID) {
    throw new Error("[SMS] Twilio requires SMS_API_SECRET (AuthToken) and SMS_SENDER_ID (from-number)");
  }

  const accountSid = env.SMS_API_KEY!;
  const authToken = env.SMS_API_SECRET;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        From: env.SMS_SENDER_ID,
        // If SMS_SENDER_ID starts with "whatsapp:" we're in WhatsApp mode — To must match
        To: env.SMS_SENDER_ID.startsWith('whatsapp:') ? `whatsapp:${e164}` : e164,
        Body: message,
      }),
    },
  );

  let body: TwilioResponse;
  try {
    body = (await resp.json()) as TwilioResponse;
  } catch {
    throw new Error(`[SMS] Twilio returned non-JSON (HTTP ${resp.status})`);
  }

  if (!resp.ok || body.error_code) {
    throw new Error(
      `[SMS] Twilio error ${body.error_code ?? resp.status}: ${body.error_message ?? body.message}`,
    );
  }

  logger.info(`[SMS] Twilio sent to ${e164} — SID: ${body.sid}`);
}
