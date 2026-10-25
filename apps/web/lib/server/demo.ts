import "server-only";
import { capabilities } from "@tsq/core/config/env";
import { AppError } from "@tsq/core/http/errors";

export function demoGuard() {
  if (!capabilities().demo) throw new AppError("DEMO_DISABLED", "在线试玩未开启");
}
