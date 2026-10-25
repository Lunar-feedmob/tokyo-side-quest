// Three separate status axes for a photo attempt (spec §9.1). Never collapse
// them into one "success" flag.

export const MODES = ["live", "demo"] as const;
export type Mode = (typeof MODES)[number];

export const PROCESSING_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const VERIFICATION_STATUSES = ["pending", "matched", "uncertain", "mismatched", "error"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const RATING_STATUSES = ["not_requested", "pending", "completed", "unscorable", "error"] as const;
export type RatingStatus = (typeof RATING_STATUSES)[number];

export const PLACE_STATUSES = ["draft", "published", "temporarily_closed", "archived"] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

export const QUEST_RUN_STATUSES = ["active", "ended_partial", "completed"] as const;
export type QuestRunStatus = (typeof QUEST_RUN_STATUSES)[number];

export const PROOF_POLICIES = ["location", "photo", "either"] as const;
export type ProofPolicy = (typeof PROOF_POLICIES)[number];

export type CheckinMethod = "location" | "photo";

export function proofPolicyAllows(policy: ProofPolicy, method: CheckinMethod): boolean {
  return policy === "either" || policy === method;
}

/** Which stage a retry may re-run, or null when the attempt is not retryable. */
export function retryableStage(a: {
  processingStatus: ProcessingStatus;
  verificationStatus: VerificationStatus;
  ratingStatus: RatingStatus;
}): "verify" | "rate" | null {
  if (a.processingStatus !== "failed") return null;
  if (a.verificationStatus === "error") return "verify";
  if (a.verificationStatus === "matched" && a.ratingStatus === "error") return "rate";
  return null;
}

export type AttemptStage = "queued" | "verifying" | "rating" | "done";

/** User-facing stage for the status table in spec §9.2. */
export function describeAttempt(a: {
  processingStatus: ProcessingStatus;
  verificationStatus: VerificationStatus;
  ratingStatus: RatingStatus;
}): string {
  const { processingStatus: p, verificationStatus: v, ratingStatus: r } = a;
  if (p === "cancelled") return "已取消";
  if (v === "pending") return p === "failed" ? "核验服务错误，可重试" : "正在核对地点";
  if (v === "error") return "核验服务错误，可重试";
  if (v === "uncertain") return "无法确认，可补拍或申请复核";
  if (v === "mismatched") return "地点不匹配，无评级";
  // matched
  if (r === "pending") return "地点匹配，正在评价照片";
  if (r === "completed") return "打卡成功，已生成评级";
  if (r === "unscorable") return "地点匹配，照片暂无法评价";
  if (r === "error") return "打卡已成功，仅评分失败";
  return "地点匹配";
}
