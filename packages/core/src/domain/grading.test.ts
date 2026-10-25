import { describe, expect, it } from "vitest";
import { computeTotal, gradeForTotal, ratePhoto } from "./grading";

describe("gradeForTotal boundaries (R01–R03)", () => {
  it.each([
    [100, "SSS"],
    [95, "SSS"],
    [94, "SS"],
    [90, "SS"],
    [89, "S"],
    [85, "S"],
    [84, "A"],
    [75, "A"],
    [74, "B"],
    [65, "B"],
    [64, "C"],
    [50, "C"],
    [49, "D"],
    [0, "D"],
  ] as const)("total %i → %s", (total, grade) => {
    expect(gradeForTotal(total)).toBe(grade);
  });
});

describe("computeTotal (R04)", () => {
  it("weights 88/82/90/86 to 87, grade S", () => {
    expect(ratePhoto({ composition: 88, lighting: 82, clarity: 90, expression: 86 })).toEqual({
      total: 87,
      grade: "S",
    });
  });

  it("rounds half up without float drift", () => {
    // 30×1 + 25×0 + 25×0 + 20×1 = 50 → 0.5 → rounds to 1
    expect(computeTotal({ composition: 1, lighting: 0, clarity: 0, expression: 1 })).toBe(1);
    expect(computeTotal({ composition: 100, lighting: 100, clarity: 100, expression: 100 })).toBe(100);
  });
});

describe("invalid scores (R05)", () => {
  it.each([
    { composition: 101, lighting: 50, clarity: 50, expression: 50 },
    { composition: -1, lighting: 50, clarity: 50, expression: 50 },
    { composition: 50.5, lighting: 50, clarity: 50, expression: 50 },
    { composition: Number.NaN, lighting: 50, clarity: 50, expression: 50 },
  ])("rejects %o", (scores) => {
    expect(() => computeTotal(scores)).toThrow(RangeError);
  });
});
