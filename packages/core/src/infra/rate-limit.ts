import { AppError } from "../http/errors";
import { redis } from "./redis";

/** Fixed-window counter. Throws RATE_LIMITED once `limit` is exceeded within the window. */
export async function enforceRateLimit(opts: {
  bucket: string;
  subject: string;
  limit: number;
  windowSeconds: number;
  message?: string;
}): Promise<void> {
  const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
  const key = `tsq:rl:${opts.bucket}:${opts.subject}:${window}`;
  const count = await redis().incr(key);
  if (count === 1) await redis().expire(key, opts.windowSeconds + 5);
  if (count > opts.limit) {
    throw new AppError("RATE_LIMITED", opts.message ?? "操作太频繁，请稍后再试", {
      retryAfterSeconds: opts.windowSeconds - (Math.floor(Date.now() / 1000) % opts.windowSeconds),
    });
  }
}
