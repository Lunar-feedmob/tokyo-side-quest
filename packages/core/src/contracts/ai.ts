import { z } from "zod";

// AI output contracts (spec §6.4, §6.8). Every model response is parsed with
// these before anything is persisted; prompts are not a substitute.

const shortText = (max: number) => z.string().trim().min(1).max(max);
// Some models behind OpenAI-compatible gateways omit a nullable field instead of
// sending null. Absent means null; the business rules below still decide validity.
const orNull = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

export const placeVerificationOutputSchema = z
  .object({
    verdict: z.enum(["matched", "uncertain", "mismatched"]),
    evidence: z
      .array(
        z
          .object({
            feature: shortText(80),
            relation: z.enum(["supports", "contradicts", "not_visible"]),
            observation: shortText(200),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    reasonCode: z.enum([
      "distinctive_features_match",
      "insufficient_evidence",
      "conflicting_landmark",
      "poor_visibility",
      "unsupported_scene",
    ]),
    userMessage: shortText(160),
    reshootSuggestion: orNull(shortText(160)),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A "matched" verdict must be backed by visible supporting evidence and no contradiction.
    if (value.verdict === "matched") {
      const supports = value.evidence.filter((e) => e.relation === "supports").length;
      const contradicts = value.evidence.some((e) => e.relation === "contradicts");
      if (supports < 1 || contradicts) {
        ctx.addIssue({ code: "custom", message: "matched verdict without consistent supporting evidence" });
      }
      if (value.reasonCode !== "distinctive_features_match") {
        ctx.addIssue({ code: "custom", message: "matched verdict must use distinctive_features_match" });
      }
    }
  });

export type PlaceVerificationOutput = z.infer<typeof placeVerificationOutputSchema>;

const score = z.number().int().min(0).max(100);

export const photoRatingOutputSchema = z
  .object({
    scorable: z.boolean(),
    dimensions: orNull(z.object({ composition: score, lighting: score, clarity: score, expression: score }).strict()),
    strength: orNull(shortText(120)),
    improvement: orNull(shortText(120)),
    unscorableReason: orNull(shortText(160)),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scorable) {
      if (!value.dimensions || !value.strength || !value.improvement) {
        ctx.addIssue({ code: "custom", message: "scorable rating requires dimensions, strength and improvement" });
      }
    } else if (!value.unscorableReason) {
      ctx.addIssue({ code: "custom", message: "unscorable rating requires unscorableReason" });
    }
  });

export type PhotoRatingOutput = z.infer<typeof photoRatingOutputSchema>;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

/** JSON Schemas handed to providers that support structured output. Zod above stays the authority. */
export const placeVerificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "evidence", "reasonCode", "userMessage", "reshootSuggestion"],
  properties: {
    verdict: { type: "string", enum: ["matched", "uncertain", "mismatched"] },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["feature", "relation", "observation"],
        properties: {
          feature: { type: "string" },
          relation: { type: "string", enum: ["supports", "contradicts", "not_visible"] },
          observation: { type: "string" },
        },
      },
    },
    reasonCode: {
      type: "string",
      enum: [
        "distinctive_features_match",
        "insufficient_evidence",
        "conflicting_landmark",
        "poor_visibility",
        "unsupported_scene",
      ],
    },
    userMessage: { type: "string" },
    reshootSuggestion: nullableString,
  },
} as const;

export const photoRatingJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scorable", "dimensions", "strength", "improvement", "unscorableReason"],
  properties: {
    scorable: { type: "boolean" },
    dimensions: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["composition", "lighting", "clarity", "expression"],
          properties: {
            composition: { type: "integer" },
            lighting: { type: "integer" },
            clarity: { type: "integer" },
            expression: { type: "integer" },
          },
        },
        { type: "null" },
      ],
    },
    strength: nullableString,
    improvement: nullableString,
    unscorableReason: nullableString,
  },
} as const;
