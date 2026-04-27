import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError, ERROR_MESSAGES } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getLang } from "@/lib/lang";

// Lazy import — Prisma client may not be generated yet at build time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PrismaKnownError: (new (...args: any[]) => { code: string }) | undefined
try {
  PrismaKnownError = require('@prisma/client').Prisma.PrismaClientKnownRequestError
} catch { /* not generated yet */ }

function getMessage(code: string, lang: "ar" | "en"): string {
  return (
    ERROR_MESSAGES[code]?.[lang] ?? ERROR_MESSAGES["internal_error"]![lang]
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const lang = getLang(req);
  const isDev = process.env["NODE_ENV"] === "development";

  // Known app error
  if (err instanceof AppError) {
    logger.warn({
      code: err.code,
      status: err.status,
      requestId: req.requestId,
    });
    return res.status(err.status).json({
      error: err.code,
      message: getMessage(err.code, lang),
    });
  }

  // Zod validation error
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "validation_error",
      message: getMessage("validation_error", lang),
      errors: err.flatten().fieldErrors,
    });
  }

  // Prisma — record not found
  if (
    PrismaKnownError &&
    err instanceof PrismaKnownError &&
    (err as { code: string }).code === "P2025"
  ) {
    return res.status(404).json({
      error: "not_found",
      message: getMessage("not_found", lang),
    });
  }

  // HTTP errors (e.g. 413 PayloadTooLarge from Express body parser)
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status: number }).status;
    return res.status(status).json({
      error: "request_error",
      message: getMessage("internal_error", lang),
    });
  }

  // Unknown — never expose internals in production
  logger.error({
    message: err instanceof Error ? err.message : "Unknown error",
    stack: err instanceof Error ? err.stack : undefined,
    requestId: req.requestId,
  });

  return res.status(500).json({
    error: "internal_error",
    message: getMessage("internal_error", lang),
    ...(isDev && err instanceof Error
      ? { detail: err.message, stack: err.stack }
      : {}),
  });
}
