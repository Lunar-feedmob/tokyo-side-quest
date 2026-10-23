import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db/client";
import {
  assets,
  places,
  placeVersions,
  quests,
  questSteps,
  questVersions,
  referenceImages,
  type PlaceContent,
} from "../db/schema";
import type { ProofPolicy } from "../domain/status";
import { AppError } from "../http/errors";
import { newObjectKeys, normalizeImage } from "../storage/images";
import { putObject } from "../storage/s3";
import { sha256Hex } from "../security/tokens";

// Content publishing with the checks from spec §12.4. Published versions are
// immutable snapshots; edits go to the draft and are re-published.

export interface ReferenceImageInput {
  bytes: Buffer;
  viewNote: string;
  sourceUrl: string;
  author: string;
  license: string;
  usageBasis: string;
  publicDisplay: boolean;
  capturedOn?: string | null;
}

export async function storeImageAsset(
  tx: DbOrTx,
  bytes: Buffer,
  kind: "reference" | "sample" | "brand",
  fixedKeys?: { main: string; model: string; thumb: string },
) {
  const image = await normalizeImage(bytes);
  const keys = fixedKeys ?? newObjectKeys(kind === "reference" ? "ref" : "sample");
  await putObject(keys.main, image.main, image.mime);
  await putObject(keys.model, image.model, image.mime);
  await putObject(keys.thumb, image.thumb, image.mime);
  const [asset] = await tx
    .insert(assets)
    .values({
      kind,
      objectKey: keys.main,
      thumbKey: keys.thumb,
      sha256: image.sha256,
      mime: image.mime,
      sizeBytes: image.main.byteLength,
      width: image.width,
      height: image.height,
    })
    .onConflictDoUpdate({
      target: assets.objectKey,
      set: { sha256: image.sha256, sizeBytes: image.main.byteLength, width: image.width, height: image.height, state: "ready" },
    })
    .returning();
  return asset!;
}

export async function addReferenceImage(placeId: string, input: ReferenceImageInput) {
  if (!input.sourceUrl || !input.license || !input.usageBasis || !input.author) {
    throw new AppError("VALIDATION_ERROR", "参考图必须记录来源、作者、许可和使用依据");
  }
  return db().transaction(async (tx) => {
    const asset = await storeImageAsset(tx, input.bytes, "reference");
    const [ref] = await tx
      .insert(referenceImages)
      .values({
        placeId,
        assetId: asset.id,
        viewNote: input.viewNote,
        sourceUrl: input.sourceUrl,
        author: input.author,
        license: input.license,
        usageBasis: input.usageBasis,
        publicDisplay: input.publicDisplay,
        capturedOn: input.capturedOn ?? null,
      })
      .returning();
    return ref!;
  });
}

export function placePublishProblems(place: { radiusM: number; draft: PlaceContent | null }): string[] {
  const problems: string[] = [];
  const c = place.draft;
  if (!c) return ["缺少地点内容"];
  if (!c.coordinateSource?.url || !c.coordinateSource.accessedOn) problems.push("缺少坐标来源或核对日期");
  if (!place.radiusM || place.radiusM <= 0) problems.push("缺少有效半径");
  if (!c.intro) problems.push("缺少简介");
  if (!c.cultureNote || c.cultureSources.length === 0) problems.push("文化观察缺少来源");
  return problems;
}

export async function publishPlace(placeId: string, publishedBy: string | null = null) {
  return db().transaction(async (tx) => {
    const [place] = await tx.select().from(places).where(eq(places.id, placeId)).for("update");
    if (!place) throw new AppError("NOT_FOUND", "地点不存在");
    const problems = placePublishProblems(place);
    if (problems.length) throw new AppError("VALIDATION_ERROR", `地点不能发布：${problems.join("；")}`, { problems });

    const refs = await tx
      .select({ id: referenceImages.id })
      .from(referenceImages)
      .where(and(eq(referenceImages.placeId, placeId), eq(referenceImages.status, "active")))
      .orderBy(asc(referenceImages.createdAt));
    const refIds = refs.map((r) => r.id);
    // Photo verification needs at least 3 licensed real references (spec §6.2, §12.4).
    const photoEnabled = place.photoEnabled && refIds.length >= 3 && (place.draft?.distinctiveFeatures.length ?? 0) > 0;

    const [last] = await tx
      .select({ version: placeVersions.version })
      .from(placeVersions)
      .where(eq(placeVersions.placeId, placeId))
      .orderBy(desc(placeVersions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const [pv] = await tx
      .insert(placeVersions)
      .values({
        placeId,
        version,
        nameZh: place.nameZh,
        nameJa: place.nameJa,
        nameEn: place.nameEn,
        content: place.draft!,
        referenceImageIds: refIds,
        referenceVersion: `ref-${sha256Hex(...refIds).slice(0, 12)}`,
        photoEnabled,
        publishedBy,
      })
      .returning();
    await tx
      .update(places)
      .set({
        publishedVersionId: pv!.id,
        status: place.status === "draft" ? "published" : place.status,
        updatedAt: new Date(),
      })
      .where(eq(places.id, placeId));
    return { versionId: pv!.id, version, photoEnabled, referenceCount: refIds.length };
  });
}

export interface QuestStepInput {
  placeId: string;
  proofPolicy: ProofPolicy;
  required?: boolean;
  title: string;
  story: string;
  objective: string;
  clue: string;
  observationQuestion: string;
  completionText: string;
}

export async function createQuestVersion(
  questId: string,
  input: {
    title: string;
    subtitle: string;
    intro: string;
    ending: string;
    estimatedMinutes: number;
    fictionNote: string;
    steps: QuestStepInput[];
  },
) {
  return db().transaction(async (tx) => {
    const [last] = await tx
      .select({ version: questVersions.version })
      .from(questVersions)
      .where(eq(questVersions.questId, questId))
      .orderBy(desc(questVersions.version))
      .limit(1);
    const [qv] = await tx
      .insert(questVersions)
      .values({
        questId,
        version: (last?.version ?? 0) + 1,
        title: input.title,
        subtitle: input.subtitle,
        intro: input.intro,
        ending: input.ending,
        estimatedMinutes: input.estimatedMinutes,
        fictionNote: input.fictionNote,
      })
      .returning();
    if (input.steps.length) {
      await tx.insert(questSteps).values(
        input.steps.map((s, i) => ({
          questVersionId: qv!.id,
          position: i + 1,
          placeId: s.placeId,
          proofPolicy: s.proofPolicy,
          required: s.required ?? true,
          title: s.title,
          story: s.story,
          objective: s.objective,
          clue: s.clue,
          observationQuestion: s.observationQuestion,
          completionText: s.completionText,
        })),
      );
    }
    return qv!;
  });
}

export async function publishQuestVersion(questVersionId: string) {
  return db().transaction(async (tx) => {
    const [qv] = await tx.select().from(questVersions).where(eq(questVersions.id, questVersionId));
    if (!qv) throw new AppError("NOT_FOUND", "故事版本不存在");
    const steps = await tx
      .select({ required: questSteps.required, placeStatus: places.status, proofPolicy: questSteps.proofPolicy, photoEnabled: places.photoEnabled, title: questSteps.title })
      .from(questSteps)
      .innerJoin(places, eq(places.id, questSteps.placeId))
      .where(eq(questSteps.questVersionId, questVersionId));
    const required = steps.filter((s) => s.required);
    if (required.length === 0) throw new AppError("VALIDATION_ERROR", "故事至少需要一个主要节点");
    const blocked = required.filter((s) => s.placeStatus !== "published" || (s.proofPolicy === "photo" && !s.photoEnabled));
    if (blocked.length) {
      throw new AppError("VALIDATION_ERROR", `主要节点的地点不可用：${blocked.map((b) => b.title).join("、")}`);
    }
    await tx.update(questVersions).set({ publishedAt: new Date() }).where(eq(questVersions.id, questVersionId));
    await tx
      .update(quests)
      .set({ publishedVersionId: questVersionId, status: "published" })
      .where(eq(quests.id, qv.questId));
    return { questId: qv.questId, version: qv.version };
  });
}

/** Distinct places referenced by required steps of active runs, used when closing a place. */
export async function activeRunsUsingPlace(placeId: string): Promise<number> {
  const res = await db().execute<{ n: number }>(sql`
    select count(distinct r.id)::int as n from quest_runs r
    join quest_steps s on s.quest_version_id = r.quest_version_id
    where r.status = 'active' and s.place_id = ${placeId}
  `);
  return res.rows[0]?.n ?? 0;
}

export async function referenceAssetsForVersion(versionId: string) {
  const [v] = await db().select().from(placeVersions).where(eq(placeVersions.id, versionId));
  if (!v || v.referenceImageIds.length === 0) return [];
  return db()
    .select({ id: referenceImages.id, objectKey: assets.objectKey, thumbKey: assets.thumbKey })
    .from(referenceImages)
    .innerJoin(assets, eq(assets.id, referenceImages.assetId))
    .where(inArray(referenceImages.id, v.referenceImageIds));
}
