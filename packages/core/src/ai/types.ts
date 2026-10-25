import type { PhotoRatingOutput, PlaceVerificationOutput } from "../contracts/ai";

export interface VisionImage {
  /** "user" is always first; references follow. */
  role: "user" | "reference";
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
  note?: string;
}

export interface VerificationTarget {
  nameZh: string;
  nameJa: string;
  distinctiveFeatures: string[];
  confusablePlaces: string[];
  unsuitableAngles: string[];
  referenceVersion: string;
}

export interface VerifyInput {
  target: VerificationTarget;
  userPhoto: VisionImage;
  references: VisionImage[];
}

export interface RateInput {
  placeNameZh: string;
  placeNameJa: string;
  userPhoto: VisionImage;
}

export interface ProviderCall<T> {
  output: T;
  model: string;
  latencyMs: number;
  usage: Record<string, unknown> | null;
  /** Number of model requests made, including the one controlled re-ask after invalid output. */
  requests: number;
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  verifyPlace(input: VerifyInput, signal?: AbortSignal): Promise<ProviderCall<PlaceVerificationOutput>>;
  ratePhoto(input: RateInput, signal?: AbortSignal): Promise<ProviderCall<PhotoRatingOutput>>;
}

export type AiErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_AUTH"
  | "AI_RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "AI_BAD_REQUEST"
  | "AI_REFUSED"
  | "AI_OUTPUT_INVALID";

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["AI_TIMEOUT", "AI_RATE_LIMITED", "AI_UNAVAILABLE"]);

/** Technical failure. Never converted into a "mismatched" or "unscorable" business result. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly latencyMs: number | null;

  constructor(code: AiErrorCode, message: string, latencyMs: number | null = null) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.latencyMs = latencyMs;
  }
}
