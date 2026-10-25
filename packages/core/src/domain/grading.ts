// Photo rating rules (spec §6.7). The model only supplies the four dimension
// scores; total and grade are always computed here on the server.

export const RUBRIC_VERSION = "photo-v1";

export const DIMENSION_WEIGHTS = {
  composition: 0.3,
  lighting: 0.25,
  clarity: 0.25,
  expression: 0.2,
} as const;

export type Dimension = keyof typeof DIMENSION_WEIGHTS;
export type DimensionScores = Record<Dimension, number>;

export const GRADES = ["SSS", "SS", "S", "A", "B", "C", "D"] as const;
export type Grade = (typeof GRADES)[number];

const GRADE_FLOORS: ReadonlyArray<readonly [Grade, number]> = [
  ["SSS", 95],
  ["SS", 90],
  ["S", 85],
  ["A", 75],
  ["B", 65],
  ["C", 50],
  ["D", 0],
];

export const GRADE_MEANINGS: Record<Grade, string> = {
  SSS: "极具表现力，让人记住这个地方",
  SS: "构图、光影和场景表达出色",
  S: "有鲜明亮点，完成度高",
  A: "主体明确，画面协调",
  B: "记录完整，还有提升空间",
  C: "已记录场景，主体或光线可以改善",
  D: "地点已匹配，但画面表达较弱，可重新挑战",
};

function assertScore(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be an integer between 0 and 100, got ${value}`);
  }
}

export function computeTotal(scores: DimensionScores): number {
  for (const key of Object.keys(DIMENSION_WEIGHTS) as Dimension[]) {
    assertScore(key, scores[key]);
  }
  // Integer arithmetic (weights × 100) avoids float drift at .5 boundaries.
  const weighted =
    scores.composition * 30 + scores.lighting * 25 + scores.clarity * 25 + scores.expression * 20;
  return Math.round(weighted / 100);
}

export function gradeForTotal(total: number): Grade {
  assertScore("total", total);
  for (const [grade, floor] of GRADE_FLOORS) {
    if (total >= floor) return grade;
  }
  return "D";
}

export function ratePhoto(scores: DimensionScores): { total: number; grade: Grade } {
  const total = computeTotal(scores);
  return { total, grade: gradeForTotal(total) };
}
