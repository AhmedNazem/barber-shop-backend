import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { requestId } from "@/middleware/request-id";
import { errorHandler } from "@/middleware/error-handler";
import { router } from "@/routes";
import { Env } from "@/config/env";
import { ObjectLockLegalHold$ } from "@aws-sdk/client-s3";

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

  app.use("/api/v1", router);

  app.use(errorHandler);

  return app;
}
