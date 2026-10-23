import { capabilities, env } from "@tsq/core/config/env";
import { route } from "@/lib/server/api";

export const GET = route(async () => {
  const c = capabilities();
  // Only what the UI needs to degrade honestly; never secrets or missing key names in detail.
  return {
    data: {
      ai: { available: c.ai.configured, testDouble: c.ai.provider === "fake" },
      storage: { available: c.storage.configured },
      map: { available: c.map.configured, styleUrl: env().MAP_STYLE_URL ?? null },
      demo: c.demo,
      simulatedLocation: c.simulatedLocation,
      testEnvironment: c.testEnvironment,
    },
  };
});
