import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { requestId } from "@/middleware/request-id";
import { errorHandler } from "@/middleware/error-handler";
import { maintenanceGuard } from "@/middleware/maintenance";
import { router } from "@/routes";
import { Env } from "@/config/env";
import { prisma } from "@/config/prisma";
import { redisClient } from "@/lib/redis";

function makeTimeout(ms: number) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: "request_timeout", message: "Request timed out" });
      }
    }, ms);
    res.on("finish", () => clearTimeout(timer));
    res.on("close",  () => clearTimeout(timer));
    next();
  };
}

export function createApp(config: Pick<Env, "NODE_ENV" | "CORS_ORIGIN">) {
  const app = express();

  app.use(helmet());

  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
    }),
  );

  app.use(requestId);

  if (config.NODE_ENV !== "test") {
    app.use(morgan("combined"));
  }

  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());

  if (config.NODE_ENV !== "test") {
    // Global baseline: 100 req/min per IP across all routes
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        limit: 100,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "rate_limited", message: "Too many requests" },
      }),
    );

    // Stricter limit on auth routes: 5 req/min per IP
    app.use(
      "/api/v1/auth",
      rateLimit({
        windowMs: 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "rate_limited", message: "Too many requests" },
      }),
    );

    // Per-user limit: 50 req/min keyed by userId (falls back to IP for unauthenticated requests)
    app.use(
      "/api/v1",
      rateLimit({
        windowMs: 60 * 1000,
        limit: 50,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
          try {
            const token = req.cookies?.barber_token as string | undefined;
            if (token) {
              const payload = jwt.decode(token) as { id?: string } | null;
              if (payload?.id) return `user:${payload.id}`;
            }
          } catch {}
          return `ip:${req.ip ?? "unknown"}`;
        },
        message: { error: "rate_limited", message: "Too many requests" },
      }),
    );
  }

  if (config.NODE_ENV !== "test") {
    app.use(maintenanceGuard)
  }

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      env: config.NODE_ENV,
      version: process.env["npm_package_version"] ?? "1.0.0",
    });
  });

  app.get("/healthz", async (_req, res) => {
    const [dbResult, redisResult] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      redisClient.ping(),
    ]);
    const db    = dbResult.status    === 'fulfilled' ? 'up' : 'down';
    const redis = redisResult.status === 'fulfilled' ? 'up' : 'down';
    const ok    = db === 'up' && redis === 'up';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      db,
      redis,
      uptime:    Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/api/v1/hair-analysis", makeTimeout(30_000)); // Gemini AI can be slow
  app.use("/api/v1", makeTimeout(8_000));
  app.use("/api/v1", router);

  app.use(errorHandler);

  return app;
}
