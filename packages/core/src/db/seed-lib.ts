import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { neighborhoods, places, quests, type PlaceContent } from "./schema";
import type { ProofPolicy } from "../domain/status";
import {
  addReferenceImage,
  createQuestVersion,
  publishPlace,
  publishQuestVersion,
  storeImageAsset,
  type ReferenceImageInput,
} from "../services/content";

// Idempotent content seeding used by `pnpm db:seed` and integration tests.
// Re-running updates drafts and only publishes a new version when needed.

export interface SeedPlace {
  slug: string;
  nameZh: string;
  nameJa: string;
  nameEn: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  photoEnabled: boolean;
  tags: string[];
  stayMinutes: number | null;
  content: PlaceContent;
  references: ReferenceImageInput[];
}

export interface SeedQuest {
  slug: string;
  title: string;
  subtitle: string;
  intro: string;
  ending: string;
  estimatedMinutes: number;
  fictionNote: string;
  steps: {
    placeSlug: string;
    proofPolicy: ProofPolicy;
    required?: boolean;
    title: string;
    story: string;
    objective: string;
    clue: string;
    observationQuestion: string;
    completionText: string;
  }[];
}

export interface SeedInput {
  neighborhood: {
    slug: string;
    nameZh: string;
    nameJa: string;
    nameEn: string | null;
    summary: string;
    center: { latitude: number; longitude: number };
  };
  places: SeedPlace[];
  quests: SeedQuest[];
  /** Demo sample images per photo-enabled place; omitted → no demo samples. */
  sampleImages?: (slug: string) => Promise<{ match: Buffer; unclear: Buffer; other: Buffer } | null>;
}

const point = (lat: number, lng: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

export async function seedContent(input: SeedInput) {
  const n = input.neighborhood;
  const [hood] = await db()
    .insert(neighborhoods)
    .values({
      slug: n.slug,
      nameZh: n.nameZh,
      nameJa: n.nameJa,
      nameEn: n.nameEn,
      summary: n.summary,
      center: point(n.center.latitude, n.center.longitude) as unknown as string,
      status: "published",
    })
    .onConflictDoUpdate({
      target: neighborhoods.slug,
      set: { nameZh: n.nameZh, nameJa: n.nameJa, nameEn: n.nameEn, summary: n.summary, status: "published" },
    })
    .returning({ id: neighborhoods.id });

  const placeIds = new Map<string, string>();
  for (const p of input.places) {
    const [row] = await db()
      .insert(places)
      .values({
        slug: p.slug,
        neighborhoodId: hood!.id,
        nameZh: p.nameZh,
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        geo: point(p.latitude, p.longitude) as unknown as string,
        radiusM: p.radiusM,
        photoEnabled: p.photoEnabled,
        tags: p.tags,
        stayMinutes: p.stayMinutes,
        draft: p.content,
      })
      .onConflictDoUpdate({
        target: places.slug,
        set: {
          nameZh: p.nameZh,
          nameJa: p.nameJa,
          nameEn: p.nameEn,
          geo: point(p.latitude, p.longitude) as unknown as string,
          radiusM: p.radiusM,
          photoEnabled: p.photoEnabled,
          tags: p.tags,
          stayMinutes: p.stayMinutes,
          draft: p.content,
          updatedAt: new Date(),
        },
      })
      .returning({ id: places.id, publishedVersionId: places.publishedVersionId });
    placeIds.set(p.slug, row!.id);

    if (!row!.publishedVersionId) {
      for (const ref of p.references) await addReferenceImage(row!.id, ref);
      await publishPlace(row!.id);
    }

    if (p.photoEnabled && input.sampleImages) {
      const imgs = await input.sampleImages(p.slug);
      if (imgs) {
        for (const kind of ["match", "unclear", "other"] as const) {
          const base = `sample/${p.slug}--${kind}`;
          await storeImageAsset(db(), imgs[kind], "sample", {
            main: `${base}/main.jpg`,
            model: `${base}/model.jpg`,
            thumb: `${base}/thumb.jpg`,
          });
        }
      }
    }
  }

  for (const q of input.quests) {
    const [quest] = await db()
      .insert(quests)
      .values({ slug: q.slug, neighborhoodId: hood!.id })
      .onConflictDoUpdate({ target: quests.slug, set: { neighborhoodId: hood!.id } })
      .returning();
    if (quest!.publishedVersionId) continue;
    const qv = await createQuestVersion(quest!.id, {
      ...q,
      steps: q.steps.map((s) => {
        const placeId = placeIds.get(s.placeSlug);
        if (!placeId) throw new Error(`quest ${q.slug} references unknown place ${s.placeSlug}`);
        return { ...s, placeId };
      }),
    });
    await publishQuestVersion(qv.id);
  }

  const result = await db().select({ id: places.id, slug: places.slug }).from(places).where(eq(places.neighborhoodId, hood!.id));
  return { neighborhoodId: hood!.id, places: Object.fromEntries(result.map((r) => [r.slug, r.id])) as Record<string, string> };
}
