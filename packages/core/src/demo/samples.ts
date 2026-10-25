import type { PhotoRatingOutput, PlaceVerificationOutput } from "../contracts/ai";

// Fixed, labelled demo outcomes (spec §3.4, §11.3). Demo attempts can only use
// these samples; an arbitrary upload is never scored by this table.

export interface DemoSample {
  key: string;
  placeSlug: string;
  label: string;
  /** Object key of the seeded sample image (kind = "sample"). */
  objectKey: string;
  verification: PlaceVerificationOutput;
  rating: PhotoRatingOutput | null;
}

const demoNote = "（试玩样例结果，不是 AI 对你照片的评价）";

export function demoSamplesFor(placeSlug: string, mainFeature: string): DemoSample[] {
  return [
    {
      key: `${placeSlug}--match`,
      placeSlug,
      label: "样例 A · 与地点一致",
      objectKey: `sample/${placeSlug}--match/main.jpg`,
      verification: {
        verdict: "matched",
        evidence: [
          { feature: mainFeature, relation: "supports", observation: `样例照片中可以看到${mainFeature}` },
          { feature: "周边结构", relation: "supports", observation: "周边结构与参考资料一致" },
        ],
        reasonCode: "distinctive_features_match",
        userMessage: `照片中的固定特征与地点资料一致。${demoNote}`,
        reshootSuggestion: null,
      },
      rating: {
        scorable: true,
        dimensions: { composition: 88, lighting: 82, clarity: 90, expression: 86 },
        strength: "前景和街道形成了清楚的纵深。",
        improvement: "稍微压低取景，减少上方空白，让地标更突出。",
        unscorableReason: null,
      },
    },
    {
      key: `${placeSlug}--unclear`,
      placeSlug,
      label: "样例 B · 特征看不清",
      objectKey: `sample/${placeSlug}--unclear/main.jpg`,
      verification: {
        verdict: "uncertain",
        evidence: [{ feature: mainFeature, relation: "not_visible", observation: "画面过近，看不到地点的独特特征" }],
        reasonCode: "insufficient_evidence",
        userMessage: `画面中缺少可以确认地点的特征。${demoNote}`,
        reshootSuggestion: `后退几步，把${mainFeature}一起拍进画面。`,
      },
      rating: null,
    },
    {
      key: `${placeSlug}--other`,
      placeSlug,
      label: "样例 C · 另一个地方",
      objectKey: `sample/${placeSlug}--other/main.jpg`,
      verification: {
        verdict: "mismatched",
        evidence: [{ feature: mainFeature, relation: "contradicts", observation: "画面中的建筑与目标地点的参考资料不一致" }],
        reasonCode: "conflicting_landmark",
        userMessage: `照片中的地标与目标地点不一致。${demoNote}`,
        reshootSuggestion: "回到目标地点，把标志性特征放进画面后重拍。",
      },
      rating: null,
    },
  ];
}
