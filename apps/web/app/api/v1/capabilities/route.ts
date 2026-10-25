import { capabilities } from "@tsq/core/config/env";
import { aiQuotaStatus } from "@tsq/core/services/ai-quota";
import { resolveAi, resolveMap } from "@tsq/core/services/settings";
import { route } from "@/lib/server/api";

export const GET = route(async () => {
  const c = capabilities();
  const [ai, map] = await Promise.all([resolveAi(), resolveMap()]);
  // A failed usage lookup must not take the capability check down; the server still enforces the limit.
  const quota = ai.configured ? await aiQuotaStatus().catch(() => null) : null;
  // Only what the UI needs to degrade honestly; never secrets or missing key names in detail.
  return {
    data: {
      ai: {
        available: ai.configured,
        testDouble: ai.provider === "fake",
        dailyLimitReached: quota?.exhausted ?? false,
        resetsAt: quota?.exhausted ? quota.resetsAt : null,
      },
      storage: { available: c.storage.configured },
      map: { available: map.configured, styleUrl: map.styleUrl },
      demo: c.demo,
      simulatedLocation: c.simulatedLocation,
      testEnvironment: c.testEnvironment,
    },
  };
});
