import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { requestId } from "@/middleware/request-id";
import { errorHandler } from "@/middleware/error-handler";
import { maintenanceGuard } from "@/middleware/maintenance";
import { router } from "@/routes";
import { Env } from "@/config/env";

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
    app.use(
      rateLimit({
        windowMs: 60 * 1000,
        limit: 100,
        standardHeaders: true,
        legacyHeaders: false,
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

  app.use("/api/v1", router);

  app.use(errorHandler);

  return app;
}
