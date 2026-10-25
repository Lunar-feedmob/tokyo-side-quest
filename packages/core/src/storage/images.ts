import { createHash, randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { AppError } from "../http/errors";

// Image intake (spec §11.1). Format is decided from the bytes, never from the
// extension or the browser's MIME type. Output is re-encoded JPEG, which drops
// EXIF (including GPS) because sharp does not copy metadata unless asked.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
const MAIN_LONG_EDGE = 2048;
const MODEL_LONG_EDGE = 1568;
const THUMB_LONG_EDGE = 480;

const SUPPORTED = new Set(["jpeg", "png", "webp"]);

export interface NormalizedImage {
  main: Buffer;
  model: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  sha256: string;
  mime: "image/jpeg";
}

export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new AppError("UPLOAD_TOO_LARGE", "图片超过 15 MB，请压缩后再上传", { maxBytes: MAX_UPLOAD_BYTES });
  }
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new AppError("INVALID_IMAGE", "无法读取这张图片，请换一张 JPEG、PNG 或 WebP 照片");
  }
  if (meta.format === "heif") {
    throw new AppError(
      "UNSUPPORTED_IMAGE",
      "暂不支持 HEIC 格式。可在相机设置中选择“兼容性最佳”，或先转换为 JPEG 后上传",
    );
  }
  if (!meta.format || !SUPPORTED.has(meta.format)) {
    throw new AppError("UNSUPPORTED_IMAGE", "仅支持 JPEG、PNG、WebP 图片");
  }
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) {
    throw new AppError("INVALID_IMAGE", "图片尺寸异常或像素过多（上限 4000 万像素）");
  }
  if ((meta.pages ?? 1) > 1) {
    throw new AppError("UNSUPPORTED_IMAGE", "不支持动图，请上传单张照片");
  }

  try {
    // rotate() applies the EXIF orientation before metadata is discarded.
    const base = sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().flatten({ background: "#ffffff" });
    const main = await base
      .clone()
      .resize({ width: MAIN_LONG_EDGE, height: MAIN_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const model = await sharp(main.data)
      .resize({ width: MODEL_LONG_EDGE, height: MODEL_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const thumb = await sharp(main.data)
      .resize({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    return {
      main: main.data,
      model,
      thumb,
      width: main.info.width,
      height: main.info.height,
      sha256: createHash("sha256").update(main.data).digest("hex"),
      mime: "image/jpeg",
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_IMAGE", "图片已损坏或无法解码");
  }
}

/** Non-enumerable object keys: <prefix>/<random>/<variant>.jpg */
export function newObjectKeys(prefix: "u" | "ref" | "poster" | "sample") {
  const dir = `${prefix}/${randomUUID()}`;
  return { main: `${dir}/main.jpg`, model: `${dir}/model.jpg`, thumb: `${dir}/thumb.jpg` };
}

/** The model-input variant lives next to the main object. */
export function modelKeyFor(mainKey: string): string {
  return mainKey.replace(/main\.jpg$/u, "model.jpg");
}
