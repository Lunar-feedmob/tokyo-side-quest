import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { aiVersions, createVisionProvider } from "../ai";
import { closeDb, db } from "../db/client";
import { assets, places, placeVersions, referenceImages } from "../db/schema";
import { ratePhoto } from "../domain/grading";
import { closeRedis } from "../infra/redis";
import { modelKeyFor } from "../storage/images";
import { getObject } from "../storage/s3";
import { resolveAi } from "../services/settings";

// `pnpm ai:smoke` — real-model smoke test (spec §18 stage B, §19.3). Uses the
// configured provider on licensed images that are NOT in the reference set:
//   1. held-out photo of the target place      → expect matched + rating
//   2. photo of a different place (Nezu gate)   → expect mismatched/uncertain
//   3. blurred crop                             → expect uncertain
// Results are appended to docs/ai-evaluation-runs.jsonl as evidence. This is a
// smoke test, not an accuracy evaluation.

async function img(objectKey: string) {
  return { mediaType: "image/jpeg" as const, data: await getObject(modelKeyFor(objectKey)) };
}

async function main() {
  const ai = await resolveAi();
  if (!ai.configured || ai.provider === "fake") {
    console.error(`未配置真实 AI（${ai.problem ?? `缺少 ${ai.missing.join(", ") || "真实 provider"}`}），无法运行冒烟测试。`);
    process.exitCode = 2;
    return;
  }
  const provider = await createVisionProvider();
  const versions = (await aiVersions())!;
  const targets = await db()
    .select({ id: places.id, slug: places.slug, versionId: places.publishedVersionId })
    .from(places)
    .where(and(eq(places.status, "published"), eq(places.photoEnabled, true)));

  const results: Record<string, unknown>[] = [];
  for (const t of targets) {
    const [version] = await db().select().from(placeVersions).where(eq(placeVersions.id, t.versionId!));
    if (!version?.photoEnabled) continue;
    const refs = await db()
      .select({ key: assets.objectKey, note: referenceImages.viewNote })
      .from(referenceImages)
      .innerJoin(assets, eq(assets.id, referenceImages.assetId))
      .where(inArray(referenceImages.id, version.referenceImageIds));
    const references = await Promise.all(refs.map(async (r) => ({ role: "reference" as const, note: r.note, ...(await img(r.key)) })));
    const cases = [
      { name: "held-out-match", key: `sample/${t.slug}--match/main.jpg`, expect: ["matched"] },
      { name: "other-place", key: `sample/${t.slug}--other/main.jpg`, expect: ["mismatched", "uncertain"] },
      { name: "blurred", key: `sample/${t.slug}--unclear/main.jpg`, expect: ["uncertain", "mismatched"] },
    ];
    for (const c of cases) {
      const started = Date.now();
      const row: Record<string, unknown> = { at: new Date().toISOString(), place: t.slug, case: c.name, ...versions };
      try {
        const userPhoto = { role: "user" as const, ...(await img(c.key)) };
        const v = await provider.verifyPlace({
          target: {
            nameZh: version.nameZh,
            nameJa: version.nameJa,
            distinctiveFeatures: version.content.distinctiveFeatures,
            confusablePlaces: version.content.confusablePlaces,
            unsuitableAngles: version.content.unsuitableAngles,
            referenceVersion: version.referenceVersion,
          },
          userPhoto,
          references,
        });
        row.verdict = v.output.verdict;
        row.reasonCode = v.output.reasonCode;
        row.verifyLatencyMs = v.latencyMs;
        row.verifyUsage = v.usage;
        row.asExpected = c.expect.includes(v.output.verdict);
        if (v.output.verdict === "matched") {
          const r = await provider.ratePhoto({ placeNameZh: version.nameZh, placeNameJa: version.nameJa, userPhoto });
          row.rating = r.output.scorable && r.output.dimensions ? { ...r.output.dimensions, ...ratePhoto(r.output.dimensions) } : { scorable: false };
          row.rateLatencyMs = r.latencyMs;
        }
      } catch (error) {
        row.error = error instanceof Error ? `${(error as { code?: string }).code ?? "ERROR"}: ${error.message}` : String(error);
        row.asExpected = false;
      }
      row.totalMs = Date.now() - started;
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
  const out = path.join(process.cwd(), "../../docs/ai-evaluation-runs.jsonl");
  await mkdir(path.dirname(out), { recursive: true });
  await appendFile(out, results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const ok = results.filter((r) => r.asExpected).length;
  console.log(`\n冒烟测试完成：${ok}/${results.length} 符合预期。结果已追加到 docs/ai-evaluation-runs.jsonl`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await closeDb();
  });
