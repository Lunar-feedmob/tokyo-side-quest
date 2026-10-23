// Error codes and HTTP mapping (spec §10.6). Business outcomes such as a
// mismatched place are successful responses, never 5xx.

export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PLACE_UNAVAILABLE: 409,
  PHOTO_CHECKIN_UNAVAILABLE: 409,
  LOCATION_OUT_OF_RANGE: 422,
  LOCATION_NEAR_BOUNDARY: 422,
  LOCATION_INACCURATE: 422,
  LOCATION_STALE: 422,
  LOCATION_CLOCK_AHEAD: 422,
  LOCATION_INVALID: 400,
  UPLOAD_TOO_LARGE: 413,
  UNSUPPORTED_IMAGE: 415,
  INVALID_IMAGE: 400,
  PHOTO_NOT_READY: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  REVIEW_ALREADY_REQUESTED: 409,
  REVIEW_NOT_ALLOWED: 409,
  AI_NOT_CONFIGURED: 503,
  AI_TIMEOUT: 502,
  AI_OUTPUT_INVALID: 502,
  STORAGE_UNAVAILABLE: 503,
  ATTEMPT_NOT_RETRYABLE: 409,
  QUEST_STEP_MISMATCH: 409,
  QUEST_RUN_CONFLICT: 409,
  DATA_DELETION_IN_PROGRESS: 409,
  DEMO_DISABLED: 404,
  SHARE_UNAVAILABLE: 404,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  "LOCATION_OUT_OF_RANGE",
  "LOCATION_NEAR_BOUNDARY",
  "LOCATION_INACCURATE",
  "LOCATION_STALE",
  "LOCATION_CLOCK_AHEAD",
  "RATE_LIMITED",
  "AI_TIMEOUT",
  "STORAGE_UNAVAILABLE",
  "PHOTO_NOT_READY",
  "INTERNAL_ERROR",
]);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.retryable = RETRYABLE.has(code);
    this.details = details;
  }
}

export const LOCATION_MESSAGES: Record<string, string> = {
  LOCATION_INVALID: "定位数据无效，请重新获取位置。",
  LOCATION_STALE: "这次定位读数已过期，请重新定位。",
  LOCATION_CLOCK_AHEAD: "设备时间似乎不准确，请校准时间后重新定位。",
  LOCATION_INACCURATE: "当前定位精度不足，请到开阔处重新定位。",
  LOCATION_NEAR_BOUNDARY: "你已靠近打卡范围边界，请再靠近一点后重新定位。",
  LOCATION_OUT_OF_RANGE: "设备报告的位置不在打卡范围内。",
};
