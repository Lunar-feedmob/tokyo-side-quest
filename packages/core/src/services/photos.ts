import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { assets } from "../db/schema";
import { AppError } from "../http/errors";
import { normalizeImage, newObjectKeys } from "../storage/images";
import { deleteObjects, getObject, putObject } from "../storage/s3";

// User photo intake. Only the normalised, EXIF-free variants are stored; the
// original upload bytes never leave this function.

export async function uploadPhoto(opts: { visitorId: string; bytes: Buffer }) {
  const image = await normalizeImage(opts.bytes);
  const keys = newObjectKeys("u");
  try {
    await putObject(keys.main, image.main, image.mime);
    await putObject(keys.model, image.model, image.mime);
    await putObject(keys.thumb, image.thumb, image.mime);
  } catch (error) {
    await deleteObjects([keys.main, keys.model, keys.thumb]).catch(() => undefined);
    throw error;
  }
  const [asset] = await db()
    .insert(assets)
    .values({
      kind: "user_photo",
      ownerVisitorId: opts.visitorId,
      mode: "live",
      objectKey: keys.main,
      thumbKey: keys.thumb,
      sha256: image.sha256,
      mime: image.mime,
      sizeBytes: image.main.byteLength,
      width: image.width,
      height: image.height,
    })
    .returning();
  return {
    assetId: asset!.id,
    state: asset!.state,
    width: asset!.width,
    height: asset!.height,
    previewUrl: `/api/v1/photos/${asset!.id}/thumb`,
  };
}

/** Returns bytes of a visitor's own photo. Ownership is checked; unknown and foreign ids look identical. */
export async function readOwnPhoto(opts: { visitorId: string; assetId: string; variant: "thumb" | "main" }) {
  const [asset] = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.id, opts.assetId), eq(assets.ownerVisitorId, opts.visitorId), eq(assets.state, "ready")))
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "没有找到这张照片");
  const key = opts.variant === "thumb" && asset.thumbKey ? asset.thumbKey : asset.objectKey;
  return { bytes: await getObject(key), mime: asset.mime };
}

export async function loadOwnReadyAsset(visitorId: string, assetId: string) {
  const [asset] = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.ownerVisitorId, visitorId), eq(assets.kind, "user_photo")))
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "没有找到这张照片");
  if (asset.state !== "ready") throw new AppError("PHOTO_NOT_READY", "这张照片已删除或正在删除");
  return asset;
}
