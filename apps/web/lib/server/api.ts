import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@tsq/core/config/env";
import { AppError } from "@tsq/core/http/errors";
import { withIdempotency } from "@tsq/core/services/idempotency";
import {
  assertWritable,
  createGuestSession,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  visitorFromToken,
  type Visitor,
} from "@tsq/core/services/session";

// Route handler plumbing for /api/v1 (spec §10): one response envelope,
// stable error codes, same-origin checks on writes, session lookup, and
// Idempotency-Key support. Handlers stay thin and call @tsq/core services.

export interface Ctx {
  req: NextRequest;
  requestId: string;
}

type Result = { status?: number; data: unknown; headers?: Record<string, string> } | Response;

function json(status: number, body: unknown, requestId: string, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId, ...headers },
  });
}

export function errorResponse(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return json(
      error.status,
      {
        error: { code: error.code, message: error.message, retryable: error.retryable, details: error.details ?? null },
        meta: { requestId },
      },
      requestId,
      error.code === "RATE_LIMITED" && typeof error.details?.retryAfterSeconds === "number"
        ? { "retry-after": String(error.details.retryAfterSeconds) }
        : {},
    );
  }
  if (error instanceof z.ZodError) {
    return json(
      400,
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数不正确",
          retryable: false,
          details: { issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        },
        meta: { requestId },
      },
      requestId,
    );
  }
  // Never leak internals; log with request id only (no bodies, images or coordinates).
  console.error(JSON.stringify({ level: "error", request_id: requestId, error: error instanceof Error ? error.message : String(error) }));
  return json(
    500,
    { error: { code: "INTERNAL_ERROR", message: "服务暂时出错，请稍后重试", retryable: true, details: null }, meta: { requestId } },
    requestId,
  );
}

/** Rejects cross-site writes. Browsers send Origin on POST/DELETE; Sec-Fetch-Site is a second signal. */
function assertSameOrigin(req: NextRequest) {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AppError("FORBIDDEN", "不允许跨站请求");
  }
  const origin = req.headers.get("origin");
  if (!origin) return;
  const allowed = new Set([new URL(env().APP_BASE_URL).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new AppError("FORBIDDEN", "不允许跨站请求");
}

export function route<P = Record<string, string>>(
  handler: (ctx: Ctx & { params: P }) => Promise<Result>,
  opts: { write?: boolean } = {},
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    // Every API response is per-request: never prerendered at build time.
    await connection();
    const requestId = randomUUID();
    try {
      if (opts.write ?? req.method !== "GET") assertSameOrigin(req);
      const params = (await routeCtx?.params) ?? ({} as P);
      const out = await handler({ req, requestId, params });
      if (out instanceof Response) {
        out.headers.set("x-request-id", requestId);
        return out;
      }
      if (out.status === 204) return new Response(null, { status: 204, headers: { "x-request-id": requestId } });
      return json(out.status ?? 200, { data: out.data, meta: { requestId } }, requestId, out.headers);
    } catch (error) {
      unstable_rethrow(error); // let Next.js control-flow errors through
      return errorResponse(error, requestId);
    }
  };
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function optionalVisitor(): Promise<Visitor | null> {
  return visitorFromToken(await sessionToken());
}

export async function requireVisitor(opts: { write?: boolean } = {}): Promise<Visitor> {
  const visitor = await optionalVisitor();
  if (!visitor) throw new AppError("UNAUTHENTICATED", "需要先创建访客身份");
  if (opts.write) assertWritable(visitor);
  return visitor;
}

export async function ensureVisitor(): Promise<{ visitor: Visitor; created: boolean }> {
  const existing = await optionalVisitor();
  if (existing) return { visitor: existing, created: false };
  const { token, visitor, expiresAt } = await createGuestSession();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_BASE_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
  return { visitor, created: true };
}

export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 64_000) throw new AppError("VALIDATION_ERROR", "请求体过大");
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("VALIDATION_ERROR", "请求体不是合法 JSON");
  }
  return schema.parse(body);
}

/** Runs a write under Idempotency-Key (if the client sent one) and returns the stored response. */
export async function idempotent(
  ctx: Ctx,
  visitorId: string,
  routeKey: string,
  body: unknown,
  run: () => Promise<{ status: number; data: unknown }>,
): Promise<Response> {
  const stored = await withIdempotency(
    { visitorId, route: routeKey, key: ctx.req.headers.get("idempotency-key"), body },
    async () => {
      const r = await run();
      return { status: r.status, body: { data: r.data } };
    },
  );
  const payload = { ...(stored.body as object), meta: { requestId: ctx.requestId } };
  return json(stored.status, payload, ctx.requestId);
}

export function clientIp(req: NextRequest): string | null {
  if (!env().TRUST_PROXY) return null;
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? (fwd.split(",")[0]?.trim() ?? null) : (req.headers.get("x-real-ip") ?? null);
}

export function modeParam(req: NextRequest): "live" | "demo" {
  return req.nextUrl.searchParams.get("mode") === "demo" ? "demo" : "live";
}
