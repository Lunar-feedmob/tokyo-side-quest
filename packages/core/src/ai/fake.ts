import sharp from "sharp";
import type { PhotoRatingOutput, PlaceVerificationOutput } from "../contracts/ai";
import { AiError, type ProviderCall, type RateInput, type VerifyInput, type VisionProvider } from "./types";

/**
 * Deterministic test double, only constructible when APP_ENV=test (enforced in
 * config/env.ts). The verdict comes from the dominant colour of the user photo
 * so separate web/worker processes agree without shared state:
 *   red → matched · green → uncertain · blue → mismatched · near-black → matched but unscorable
 * Failures can be injected through `FakeFaults` (backed by Redis in the worker).
 */
export interface FakeFaults {
  failVerify(): Promise<boolean>;
  failRating(): Promise<boolean>;
}

type Colour = "red" | "green" | "blue" | "dark" | "other";

async function dominantColour(data: Buffer): Promise<Colour> {
  const { channels } = await sharp(data).stats();
  const [r, g, b] = channels.map((c) => c.mean) as [number, number, number];
  if (r < 30 && g < 30 && b < 30) return "dark";
  if (r > g + 40 && r > b + 40) return "red";
  if (g > r + 40 && g > b + 40) return "green";
  if (b > r + 40 && b > g + 40) return "blue";
  return "other";
}

export class FakeVisionProvider implements VisionProvider {
  readonly name = "fake";
  readonly model = "fake-vision-1";

  constructor(private readonly faults: FakeFaults) {}

  async verifyPlace(input: VerifyInput): Promise<ProviderCall<PlaceVerificationOutput>> {
    if (await this.faults.failVerify()) throw new AiError("AI_UNAVAILABLE", "测试注入：核验服务不可用", 5);
    const colour = await dominantColour(input.userPhoto.data);
    const feature = input.target.distinctiveFeatures[0] ?? "目标地标";
    let output: PlaceVerificationOutput;
    if (colour === "red" || colour === "dark") {
      output = {
        verdict: "matched",
        evidence: [
          { feature, relation: "supports", observation: "测试替身：与参考资料一致" },
          { feature: "周边结构", relation: "supports", observation: "测试替身：周边结构一致" },
        ],
        reasonCode: "distinctive_features_match",
        userMessage: "照片中的固定特征与参考资料一致（测试替身）。",
        reshootSuggestion: null,
      };
    } else if (colour === "blue") {
      output = {
        verdict: "mismatched",
        evidence: [{ feature, relation: "contradicts", observation: "测试替身：出现冲突地标" }],
        reasonCode: "conflicting_landmark",
        userMessage: "照片中的地标与目标地点不一致（测试替身）。",
        reshootSuggestion: "回到目标地点，把标志性特征放进画面后重拍。",
      };
    } else {
      output = {
        verdict: "uncertain",
        evidence: [{ feature, relation: "not_visible", observation: "测试替身：特征不可见" }],
        reasonCode: "insufficient_evidence",
        userMessage: "画面中看不到足够的地点特征（测试替身）。",
        reshootSuggestion: "后退几步，把招牌和建筑立面一起拍进画面。",
      };
    }
    return { output, model: this.model, latencyMs: 5, usage: null, requests: 1 };
  }

  async ratePhoto(input: RateInput): Promise<ProviderCall<PhotoRatingOutput>> {
    if (await this.faults.failRating()) throw new AiError("AI_UNAVAILABLE", "测试注入：评分服务不可用", 5);
    const colour = await dominantColour(input.userPhoto.data);
    const output: PhotoRatingOutput =
      colour === "dark"
        ? {
            scorable: false,
            dimensions: null,
            strength: null,
            improvement: null,
            unscorableReason: "画面几乎全黑，无法评价（测试替身）。",
          }
        : {
            scorable: true,
            // 88/82/90/86 → total 87, grade S (spec R04)
            dimensions: { composition: 88, lighting: 82, clarity: 90, expression: 86 },
            strength: "测试替身：主体清楚。",
            improvement: "测试替身：稍微压低取景。",
            unscorableReason: null,
          };
    return { output, model: this.model, latencyMs: 5, usage: null, requests: 1 };
  }
}
