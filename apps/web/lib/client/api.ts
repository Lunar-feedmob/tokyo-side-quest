"use client";

// Browser-side API client for /api/v1. Server responses are the source of
// truth; this only transports evidence and renders what comes back.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> | null,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/gu, "");
}

async function parse<T>(res: Response): Promise<T> {
  const requestId = res.headers.get("x-request-id");
  if (res.status === 204) return undefined as T;
  let body: { data?: T; error?: { code: string; message: string; retryable: boolean; details: Record<string, unknown> | null } };
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "INTERNAL_ERROR", "服务返回了无法识别的内容", true, null, requestId);
  }
  if (!res.ok || body.error) {
    const e = body.error ?? { code: "INTERNAL_ERROR", message: "请求失败", retryable: true, details: null };
    throw new ApiError(res.status, e.code, e.message, e.retryable, e.details, requestId);
  }
  return body.data as T;
}

export async function apiGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { credentials: "same-origin", signal: init?.signal, cache: "no-store" });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请检查网络后重试", true, null, null);
  }
  return parse<T>(res);
}

/** POST with a fresh Idempotency-Key per logical action; pass `key` to reuse it on retry. */
export async function apiPost<T>(path: string, body: unknown = {}, opts: { key?: string; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "idempotency-key": opts.key ?? newIdempotencyKey(), ...opts.headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请检查网络后重试", true, null, null);
  }
  return parse<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: "DELETE", credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请检查网络后重试", true, null, null);
  }
  return parse<T>(res);
}

/** Multipart upload with real byte progress (fetch cannot report upload progress). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1${path}`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { data?: T; error?: { code: string; message: string; retryable: boolean; details: Record<string, unknown> | null } } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.data !== undefined) resolve(body.data);
      else {
        const e = body?.error ?? { code: "INTERNAL_ERROR", message: "上传失败", retryable: true, details: null };
        reject(new ApiError(xhr.status, e.code, e.message, e.retryable, e.details, xhr.getResponseHeader("x-request-id")));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "网络连接失败，上传未完成", true, null, null));
    xhr.send(form);
  });
}

export async function ensureSession(): Promise<void> {
  await apiPost("/session/guest");
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "出现了意外问题，请稍后重试";
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请检查网络后重试", true, null, null);
  }
  return parse<T>(res);
}
