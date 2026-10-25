import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import {
  assets,
  checkins,
  photoAttempts,
  photoRatings,
  places,

  posters,
  questRuns,
  questVersions,
  quests,
  shareLinks,
  stampAwards,
  type PosterSnapshot,
} from "../db/schema";
import type { Mode } from "../domain/status";
import { AppError } from "../http/errors";
import { enqueueInTx } from "../queue/outbox";
import { hashToken, randomToken, seal, unseal } from "../security/tokens";
import { POSTER_TEMPLATE_VERSION, renderPosterPng, tokyoDateLabel } from "../posters/render";
import { deleteObjects, getObject, putObject } from "../storage/s3";

// Keepsake posters and public share links (spec §14). Preview/download stay
// private; a public link exists only after the owner explicitly creates it,
// and revoking it makes the public page and image unreachable at once.

export function renderJobId(posterId: string, n: number) {
  return `${posterId}:render:${n}`;
}

async function placeStampLabel(visitorId: string, mode: Mode, placeId: string) {
  const [p] = await db().select({ slug: places.slug, nameZh: places.nameZh }).from(places).where(eq(places.id, placeId));
  if (!p) return null;
  const [s] = await db()
    .select({ id: stampAwards.id })
    .from(stampAwards)
    .where(and(eq(stampAwards.visitorId, visitorId), eq(stampAwards.mode, mode), eq(stampAwards.stampKey, `place:${p.slug}`)));
  return s ? p.nameZh : null;
}

async function loadCoverAttempt(visitorId: string, mode: Mode, attemptId: string) {
  const [row] = await db()
    .select({ a: photoAttempts, assetState: assets.state, grade: photoRatings.grade })
    .from(photoAttempts)
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .leftJoin(photoRatings, eq(photoRatings.attemptId, photoAttempts.id))
    .where(and(eq(photoAttempts.id, attemptId), eq(photoAttempts.visitorId, visitorId)))
    .limit(1);
  if (!row || row.a.mode !== mode) throw new AppError("NOT_FOUND", "没有找到这张作品");
  if (row.a.verificationStatus !== "matched" || row.assetState !== "ready" || row.a.cancelledAt) {
    throw new AppError("VALIDATION_ERROR", "只能使用通过地点核验、且仍然保存的照片作为封面");
  }
  return { attempt: row.a, grade: row.a.ratingStatus === "completed" ? row.grade : null };
}

export async function createPoster(opts: {
  visitorId: string;
  mode: Mode;
  kind: "place" | "quest";
  placeId?: string;
  questRunId?: string;
  coverAttemptId: string | null;
  caption: string | null;
}): Promise<{ posterId: string }> {
  const caption = opts.caption?.trim() ? [...opts.caption.trim()].slice(0, 40).join("") : null;
  let snapshot: PosterSnapshot;

  const cover = opts.coverAttemptId ? await loadCoverAttempt(opts.visitorId, opts.mode, opts.coverAttemptId) : null;

  if (opts.kind === "place") {
    const placeId = opts.placeId ?? cover?.attempt.placeId;
    if (!placeId) throw new AppError("VALIDATION_ERROR", "缺少地点");
    if (cover && cover.attempt.placeId !== placeId) throw new AppError("VALIDATION_ERROR", "封面照片不属于这个地点");
    const [visited] = await db()
      .select({ id: checkins.id })
      .from(checkins)
      .where(and(eq(checkins.visitorId, opts.visitorId), eq(checkins.mode, opts.mode), eq(checkins.placeId, placeId)))
      .limit(1);
    if (!visited) throw new AppError("VALIDATION_ERROR", "完成这个地点的打卡后才能生成票根");
    const [p] = await db()
      .select({ nameZh: places.nameZh, nameJa: places.nameJa, hood: sql<string>`(select name_zh from neighborhoods n where n.id = ${places.neighborhoodId})` })
      .from(places)
      .where(eq(places.id, placeId));
    const stamp = await placeStampLabel(opts.visitorId, opts.mode, placeId);
    snapshot = {
      templateVersion: POSTER_TEMPLATE_VERSION,
      mode: opts.mode,
      kind: "place",
      title: p!.nameZh,
      subtitle: `${p!.hood} · 地点打卡`,
      nameJa: p!.nameJa,
      dateTokyo: tokyoDateLabel(),
      caption,
      grade: cover?.grade ?? null,
      stamps: stamp ? [stamp] : [],
      questCompleted: null,
      coverAssetId: cover?.attempt.assetId ?? null,
      coverAttemptId: cover?.attempt.id ?? null,
    };
  } else {
    if (!opts.questRunId) throw new AppError("VALIDATION_ERROR", "缺少故事探索");
    const [run] = await db()
      .select({ run: questRuns, title: questVersions.title, slug: quests.slug })
      .from(questRuns)
      .innerJoin(questVersions, eq(questVersions.id, questRuns.questVersionId))
      .innerJoin(quests, eq(quests.id, questRuns.questId))
      .where(and(eq(questRuns.id, opts.questRunId), eq(questRuns.visitorId, opts.visitorId), eq(questRuns.mode, opts.mode)));
    if (!run) throw new AppError("NOT_FOUND", "没有找到这次故事探索");
    const completed = run.run.status === "completed";
    snapshot = {
      templateVersion: POSTER_TEMPLATE_VERSION,
      mode: opts.mode,
      kind: "quest",
      title: run.title,
      subtitle: completed ? "原创故事 · 已完成" : "原创故事 · 探索中",
      nameJa: null,
      dateTokyo: tokyoDateLabel(),
      caption,
      grade: cover?.grade ?? null,
      stamps: completed ? ["故事完成"] : [],
      questCompleted: completed,
      coverAssetId: cover?.attempt.assetId ?? null,
      coverAttemptId: cover?.attempt.id ?? null,
    };
  }

  return db().transaction(async (tx) => {
    const [poster] = await tx
      .insert(posters)
      .values({ ownerVisitorId: opts.visitorId, mode: opts.mode, templateVersion: POSTER_TEMPLATE_VERSION, snapshot })
      .returning({ id: posters.id });
    await enqueueInTx(tx, "poster.render", poster!.id, renderJobId(poster!.id, 0));
    return { posterId: poster!.id };
  });
}

async function activeShare(posterId: string) {
  const [share] = await db()
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.posterId, posterId), isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, new Date())))
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  return share ?? null;
}

function shareUrl(token: string) {
  return `${env().APP_BASE_URL.replace(/\/$/u, "")}/s/${token}`;
}

/** Worker: render the poster from its immutable snapshot (plus QR when actively shared). */
export async function renderPoster(posterId: string) {
  const [poster] = await db().select().from(posters).where(eq(posters.id, posterId));
  if (!poster || poster.status === "deleted") return { skipped: "missing" as const };
  // A re-render (e.g. adding the share QR) keeps serving the previous image until the new one is ready.
  if (poster.status !== "ready") {
    await db().update(posters).set({ status: "rendering", updatedAt: new Date() }).where(eq(posters.id, posterId));
  }

  let coverJpeg: Buffer | null = null;
  if (poster.snapshot.coverAssetId) {
    const [cover] = await db().select().from(assets).where(eq(assets.id, poster.snapshot.coverAssetId));
    // A deleted cover falls back to the brand background; it is never resurrected.
    if (cover?.state === "ready") coverJpeg = await getObject(cover.objectKey);
  }
  const share = await activeShare(posterId);
  const png = await renderPosterPng({
    snapshot: poster.snapshot,
    coverJpeg,
    shareUrl: share ? shareUrl(unseal(share.tokenSealed)) : null,
  });

  const key = `poster/${randomUUID()}/poster.png`;
  await putObject(key, png, "image/png");
  const [asset] = await db()
    .insert(assets)
    .values({
      kind: "poster",
      ownerVisitorId: poster.ownerVisitorId,
      mode: poster.mode,
      objectKey: key,
      sha256: "",
      mime: "image/png",
      sizeBytes: png.byteLength,
      width: 1080,
      height: 1440,
    })
    .returning();

  const [current] = await db().select({ status: posters.status, assetId: posters.assetId }).from(posters).where(eq(posters.id, posterId));
  if (!current || current.status === "deleted") {
    await deleteObjects([key]);
    await db().update(assets).set({ state: "deleted", deletedAt: new Date() }).where(eq(assets.id, asset!.id));
    return { skipped: "deleted" as const };
  }
  await db()
    .update(posters)
    .set({ assetId: asset!.id, renderedWithShareId: share?.id ?? null, status: "ready", errorCode: null, updatedAt: new Date() })
    .where(eq(posters.id, posterId));
  if (current.assetId) await retireAsset(current.assetId);
  return { rendered: true, shared: Boolean(share) };
}

async function retireAsset(assetId: string) {
  const [old] = await db().select().from(assets).where(eq(assets.id, assetId));
  if (!old || old.state === "deleted") return;
  await deleteObjects([old.objectKey, old.thumbKey ?? ""].filter(Boolean));
  await db().update(assets).set({ state: "deleted", deletedAt: new Date() }).where(eq(assets.id, assetId));
}

export async function markPosterFailed(posterId: string, code: string) {
  await db().update(posters).set({ status: "failed", errorCode: code, updatedAt: new Date() }).where(and(eq(posters.id, posterId), ne(posters.status, "deleted")));
}

export async function retryPoster(opts: { visitorId: string; posterId: string }) {
  return db().transaction(async (tx) => {
    const [p] = await tx.select().from(posters).where(and(eq(posters.id, opts.posterId), eq(posters.ownerVisitorId, opts.visitorId))).for("update");
    if (!p || p.status === "deleted") throw new AppError("NOT_FOUND", "没有找到这张票根");
    if (p.status !== "failed") throw new AppError("ATTEMPT_NOT_RETRYABLE", "这张票根不需要重试");
    await tx.update(posters).set({ status: "queued", errorCode: null, updatedAt: new Date() }).where(eq(posters.id, p.id));
    await enqueueInTx(tx, "poster.render", p.id, renderJobId(p.id, Date.now()));
    return { posterId: p.id };
  });
}

export async function getPoster(opts: { visitorId: string; posterId: string }) {
  const [p] = await db()
    .select()
    .from(posters)
    .where(and(eq(posters.id, opts.posterId), eq(posters.ownerVisitorId, opts.visitorId), ne(posters.status, "deleted")));
  if (!p) throw new AppError("NOT_FOUND", "没有找到这张票根");
  const share = await activeShare(p.id);
  return {
    posterId: p.id,
    mode: p.mode,
    status: p.status,
    errorCode: p.errorCode,
    snapshot: {
      title: p.snapshot.title,
      subtitle: p.snapshot.subtitle,
      dateTokyo: p.snapshot.dateTokyo,
      caption: p.snapshot.caption,
      grade: p.snapshot.grade,
      stamps: p.snapshot.stamps,
      hasCover: Boolean(p.snapshot.coverAssetId),
    },
    imageUrl: p.status === "ready" && p.assetId ? `/api/v1/posters/${p.id}/image?v=${p.assetId.slice(0, 8)}` : null,
    qrIncluded: Boolean(share && p.renderedWithShareId === share.id),
    share: share
      ? { shareId: share.id, url: shareUrl(unseal(share.tokenSealed)), expiresAt: share.expiresAt, createdAt: share.createdAt }
      : null,
    createdAt: p.createdAt,
  };
}

export async function readPosterImage(opts: { visitorId: string; posterId: string }) {
  const [row] = await db()
    .select({ key: assets.objectKey })
    .from(posters)
    .innerJoin(assets, eq(assets.id, posters.assetId))
    .where(and(eq(posters.id, opts.posterId), eq(posters.ownerVisitorId, opts.visitorId), eq(posters.status, "ready"), eq(assets.state, "ready")));
  if (!row) throw new AppError("NOT_FOUND", "票根还没有生成或已删除");
  return getObject(row.key);
}

export async function listPosters(visitorId: string, mode: Mode) {
  const rows = await db()
    .select({
      id: posters.id,
      status: posters.status,
      snapshot: posters.snapshot,
      createdAt: posters.createdAt,
      shared: sql<boolean>`exists (select 1 from share_links s where s.poster_id = ${posters.id} and s.revoked_at is null and s.expires_at > now())`,
    })
    .from(posters)
    .where(and(eq(posters.ownerVisitorId, visitorId), eq(posters.mode, mode), ne(posters.status, "deleted")))
    .orderBy(desc(posters.createdAt));
  return rows.map((r) => ({ id: r.id, status: r.status, title: r.snapshot.title, createdAt: r.createdAt, shared: r.shared }));
}

/** Fields that become public when a share is created; shown to the user before confirming. */
export const PUBLIC_SHARE_FIELDS = ["票根图片（含封面照片、地点或故事名、评级、印章、日期、短句、二维码）"];

export async function createShare(opts: { visitorId: string; posterId: string }) {
  return db().transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(posters)
      .where(and(eq(posters.id, opts.posterId), eq(posters.ownerVisitorId, opts.visitorId)))
      .for("update");
    if (!p || p.status === "deleted") throw new AppError("NOT_FOUND", "没有找到这张票根");
    if (p.mode === "demo") throw new AppError("FORBIDDEN", "试玩票根不能创建公开分享链接");
    if (p.status !== "ready") throw new AppError("PHOTO_NOT_READY", "票根生成完成后才能分享");
    const [existing] = await tx
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.posterId, p.id), isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, new Date())));
    if (existing) return { shareId: existing.id, url: shareUrl(unseal(existing.tokenSealed)), expiresAt: existing.expiresAt, created: false };

    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + env().SHARE_TTL_DAYS * 86_400_000);
    const [share] = await tx
      .insert(shareLinks)
      .values({ posterId: p.id, ownerVisitorId: opts.visitorId, tokenHash: hashToken(token), tokenSealed: seal(token), expiresAt })
      .returning();
    // Re-render so the downloadable PNG carries the real QR code (never a placeholder).
    await enqueueInTx(tx, "poster.render", p.id, renderJobId(p.id, Date.now()));
    return { shareId: share!.id, url: shareUrl(token), expiresAt, created: true };
  });
}

export async function revokeShare(opts: { visitorId: string; shareId: string }) {
  return db().transaction(async (tx) => {
    const [share] = await tx
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.id, opts.shareId), eq(shareLinks.ownerVisitorId, opts.visitorId)))
      .for("update");
    if (!share) throw new AppError("NOT_FOUND", "没有找到这个分享链接");
    if (share.revokedAt) return { revoked: true };
    await tx.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, share.id));
    // Remove the now-dead QR from the private poster too.
    const [p] = await tx.select({ status: posters.status }).from(posters).where(eq(posters.id, share.posterId));
    if (p && p.status !== "deleted") {
      await enqueueInTx(tx, "poster.render", share.posterId, renderJobId(share.posterId, Date.now()));
    }
    return { revoked: true };
  });
}

/** Revoke every active share that shows a given photo (called on photo deletion). */
export async function revokeSharesForAsset(tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0], assetId: string) {
  const affected = await tx
    .select({ id: posters.id })
    .from(posters)
    .where(sql`${posters.snapshot}->>'coverAssetId' = ${assetId} and ${posters.status} <> 'deleted'`);
  const ids = affected.map((a) => a.id);
  if (ids.length === 0) return ids;
  await tx.update(shareLinks).set({ revokedAt: new Date() }).where(and(inArray(shareLinks.posterId, ids), isNull(shareLinks.revokedAt)));
  return ids;
}

async function resolvePublic(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/u.test(token)) return null;
  const [row] = await db()
    .select({ share: shareLinks, poster: posters, assetKey: assets.objectKey, assetState: assets.state })
    .from(shareLinks)
    .innerJoin(posters, eq(posters.id, shareLinks.posterId))
    .leftJoin(assets, eq(assets.id, posters.assetId))
    .where(eq(shareLinks.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  if (row.share.revokedAt || row.share.expiresAt <= new Date()) return null;
  if (row.poster.status === "deleted" || row.poster.mode !== "live") return null;
  return row;
}

/** Minimal public snapshot: nothing beyond what is printed on the poster itself. */
export async function getPublicShare(token: string) {
  const row = await resolvePublic(token);
  if (!row) throw new AppError("SHARE_UNAVAILABLE", "这个分享链接已失效或被撤销");
  const s = row.poster.snapshot;
  return {
    title: s.title,
    subtitle: s.subtitle,
    dateTokyo: s.dateTokyo,
    caption: s.caption,
    grade: s.grade,
    ready: row.poster.status === "ready" && row.assetState === "ready",
    imageUrl: `/api/v1/public/shares/${token}/image`,
    expiresAt: row.share.expiresAt,
  };
}

export async function readPublicShareImage(token: string) {
  const row = await resolvePublic(token);
  if (!row || row.poster.status !== "ready" || row.assetState !== "ready" || !row.assetKey) {
    throw new AppError("SHARE_UNAVAILABLE", "这个分享链接已失效或被撤销");
  }
  return getObject(row.assetKey);
}

export async function listShares(visitorId: string) {
  return db()
    .select({
      shareId: shareLinks.id,
      posterId: shareLinks.posterId,
      createdAt: shareLinks.createdAt,
      expiresAt: shareLinks.expiresAt,
      revokedAt: shareLinks.revokedAt,
      title: sql<string>`${posters.snapshot}->>'title'`,
    })
    .from(shareLinks)
    .innerJoin(posters, eq(posters.id, shareLinks.posterId))
    .where(eq(shareLinks.ownerVisitorId, visitorId))
    .orderBy(desc(shareLinks.createdAt));
}

/** Matched photos a visitor can pick as cover, grouped for the poster editor. */
export async function coverCandidates(opts: { visitorId: string; mode: Mode; placeIds?: string[] }) {
  const rows = await db()
    .select({
      attemptId: photoAttempts.id,
      placeId: photoAttempts.placeId,
      placeNameZh: places.nameZh,
      grade: photoRatings.grade,
      assetKind: assets.kind,
      assetId: photoAttempts.assetId,
      sampleKey: photoAttempts.sampleKey,
    })
    .from(photoAttempts)
    .innerJoin(places, eq(places.id, photoAttempts.placeId))
    .innerJoin(assets, eq(assets.id, photoAttempts.assetId))
    .leftJoin(photoRatings, eq(photoRatings.attemptId, photoAttempts.id))
    .where(
      and(
        eq(photoAttempts.visitorId, opts.visitorId),
        eq(photoAttempts.mode, opts.mode),
        eq(photoAttempts.verificationStatus, "matched"),
        eq(assets.state, "ready"),
        isNull(photoAttempts.cancelledAt),
        opts.placeIds?.length ? inArray(photoAttempts.placeId, opts.placeIds) : undefined,
      ),
    )
    .orderBy(desc(photoAttempts.createdAt))
    .limit(30);
  return rows.map((r) => ({
    ...r,
    thumbUrl: r.assetKind === "sample" ? `/api/v1/demo/samples/${encodeURIComponent(r.sampleKey ?? "")}/image` : `/api/v1/photos/${r.assetId}/thumb`,
  }));
}

export async function questPlaceIds(runId: string): Promise<string[]> {
  const res = await db().execute<{ place_id: string }>(sql`
    select distinct s.place_id from quest_runs r join quest_steps s on s.quest_version_id = r.quest_version_id where r.id = ${runId}
  `);
  return res.rows.map((r) => r.place_id);
}

