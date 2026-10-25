import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callStructured, jsonPayload } from "./structured";

describe("jsonPayload", () => {
  it("drops a leading reasoning block and a code fence", () => {
    expect(jsonPayload('<think>\nNeed JSON.\n</think>\n\n{"ok":true}')).toBe('{"ok":true}');
    expect(jsonPayload('<thinking>a</thinking><think>b</think>```json\n{"ok":true}\n```')).toBe('{"ok":true}');
    expect(jsonPayload('  {"ok":true}  ')).toBe('{"ok":true}');
  });

  it("leaves a reasoning block that is not leading alone", () => {
    expect(jsonPayload('{"ok":true}<think>x</think>')).toBe('{"ok":true}<think>x</think>');
  });
});

describe("callStructured", () => {
  it("accepts a reasoning model's reply without a re-ask", async () => {
    let calls = 0;
    const result = await callStructured(z.object({ ok: z.boolean() }), async () => {
      calls += 1;
      return { text: '<think>\nWe need JSON.\n</think>\n\n{"ok":true}', model: "MiniMax-M3", usage: null };
    });
    expect(result.output).toEqual({ ok: true });
    expect(calls).toBe(1);
  });
});

describe("output contracts", () => {
  it("treat an omitted nullable field as null but keep the business rules", async () => {
    const { photoRatingOutputSchema, placeVerificationOutputSchema } = await import("../contracts/ai");
    expect(photoRatingOutputSchema.parse({ scorable: false, unscorableReason: "纯色图片，无法评价。" })).toEqual({
      scorable: false,
      dimensions: null,
      strength: null,
      improvement: null,
      unscorableReason: "纯色图片，无法评价。",
    });
    expect(photoRatingOutputSchema.safeParse({ scorable: true, strength: "构图稳定", improvement: "压低视角" }).success).toBe(false);
    expect(photoRatingOutputSchema.safeParse({ scorable: false }).success).toBe(false);
    const verification = placeVerificationOutputSchema.parse({
      verdict: "matched",
      evidence: [{ feature: "瓦土墙", relation: "supports", observation: "瓦片与土层交替" }],
      reasonCode: "distinctive_features_match",
      userMessage: "是这个地点。",
    });
    expect(verification.reshootSuggestion).toBeNull();
  });
});
