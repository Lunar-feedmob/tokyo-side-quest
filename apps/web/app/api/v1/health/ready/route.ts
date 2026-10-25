import { readiness } from "@/lib/server/readiness";
import { route } from "@/lib/server/api";

// Public readiness: pass/fail per dependency only. Configuration details are in /api/v1/admin/health.
export const GET = route(async () => {
  const r = await readiness();
  const checks = Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, { ok: v.ok }]));
  return { status: r.ready ? 200 : 503, data: { ready: r.ready, checks, degraded: r.degraded } };
});
