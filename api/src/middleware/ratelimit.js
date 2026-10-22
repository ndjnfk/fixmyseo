import rateLimit from "express-rate-limit";
import { config } from "../config.js";

const common = { standardHeaders: "draft-7", legacyHeaders: false, message: { error: "too many requests" } };

export const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX, ...common,
  skip: () => config.NODE_ENV === "test",
});

export const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: config.AUTH_RATE_LIMIT_MAX, ...common,
  skip: () => config.NODE_ENV === "test",
});
