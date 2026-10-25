import { RUBRIC_VERSION } from "../domain/grading";
import { aiVersions, type AiVersions } from "../ai";
import { sha256Hex } from "../security/tokens";

// Everything that can change an AI result is part of the evaluation cache key
// (spec §6.9): same visitor + same image + same versions → same result.

export const DEMO_VERSIONS: AiVersions = {
  provider: "demo_sample",
  model: "demo-sample-1",
  modelConfigVersion: "demo-1",
  verifyPromptVersion: "demo-1",
  ratingPromptVersion: "demo-1",
};

export interface EvaluationKeyInput {
  visitorId: string;
  mode: "live" | "demo";
  placeVersionId: string;
  referenceVersion: string;
  imageSha256: string;
  versions: AiVersions;
}

export function evaluationCacheKey(i: EvaluationKeyInput): string {
  return sha256Hex(
    "eval-v1",
    i.visitorId,
    i.mode,
    i.placeVersionId,
    i.referenceVersion,
    i.imageSha256,
    i.versions.provider,
    i.versions.model,
    i.versions.modelConfigVersion,
    i.versions.verifyPromptVersion,
    i.versions.ratingPromptVersion,
    RUBRIC_VERSION,
  );
}

/** context_key is never null so the unique dedupe key cannot be bypassed by NULLs (spec §8.3). */
export function contextKey(questRunId: string | null, questStepId: string | null): string {
  return questRunId && questStepId ? `quest:${questRunId}:${questStepId}` : "free";
}

export function attemptDedupeKey(evaluationKey: string, ctx: string): string {
  return sha256Hex("attempt-v1", evaluationKey, ctx);
}

export async function currentAiVersions(mode: "live" | "demo"): Promise<AiVersions | null> {
  return mode === "demo" ? DEMO_VERSIONS : aiVersions();
}
