import { z } from "zod";

// Request bodies for /api/v1 (spec §10). Clients never send visitorId,
// distance, total, grade or reward fields; strict() rejects them.

const uuid = z.uuid();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const positionSchema = z
  .object({
    latitude,
    longitude,
    accuracyMeters: z.number().min(0).max(100_000),
    capturedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type PositionInput = z.infer<typeof positionSchema>;

const questContext = {
  questRunId: uuid.nullable().default(null),
  questStepId: uuid.nullable().default(null),
};

function questPairRefine(v: { questRunId: string | null; questStepId: string | null }, ctx: z.RefinementCtx) {
  if ((v.questRunId === null) !== (v.questStepId === null)) {
    ctx.addIssue({ code: "custom", message: "questRunId 与 questStepId 必须同时为空或同时提供" });
  }
}

export const nearbyRequestSchema = z
  .object({
    latitude,
    longitude,
    radiusMeters: z.number().int().min(100).max(3000).default(1500),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const locationCheckinRequestSchema = z
  .object({ placeId: uuid, position: positionSchema, ...questContext })
  .strict()
  .superRefine(questPairRefine);

export const photoAttemptRequestSchema = z
  .object({ placeId: uuid, assetId: uuid, position: positionSchema.nullable().default(null), ...questContext })
  .strict()
  .superRefine(questPairRefine);

export const demoPhotoAttemptRequestSchema = z
  .object({ placeId: uuid, sampleKey: z.string().min(1).max(64), ...questContext })
  .strict()
  .superRefine(questPairRefine);

export const startQuestRunRequestSchema = z.object({ questId: uuid }).strict();

export const reviewRequestSchema = z.object({ note: z.string().trim().max(200).optional() }).strict();

export const createPosterRequestSchema = z
  .object({
    kind: z.enum(["place", "quest"]),
    placeId: uuid.optional(),
    questRunId: uuid.optional(),
    coverAttemptId: uuid.nullable().default(null),
    caption: z.string().trim().max(40).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "place" && !v.placeId) ctx.addIssue({ code: "custom", message: "placeId required" });
    if (v.kind === "quest" && !v.questRunId) ctx.addIssue({ code: "custom", message: "questRunId required" });
  });

export const adminReviewDecisionSchema = z
  .object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(2).max(300) })
  .strict();
