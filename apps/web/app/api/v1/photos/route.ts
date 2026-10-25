import { AppError } from "@tsq/core/http/errors";
import { enforceRateLimit } from "@tsq/core/infra/rate-limit";
import { MAX_UPLOAD_BYTES } from "@tsq/core/storage/images";
import { uploadPhoto } from "@tsq/core/services/photos";
import { assertWritable } from "@tsq/core/services/session";
import { ensureVisitor, route } from "@/lib/server/api";

export const POST = route(async ({ req }) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new AppError("UPLOAD_TOO_LARGE", "图片超过 15 MB，请压缩后再上传");
  const { visitor } = await ensureVisitor();
  assertWritable(visitor);
  await enforceRateLimit({ bucket: "upload", subject: visitor.id, limit: 60, windowSeconds: 3600, message: "上传太频繁，请稍后再试" });
  let file: File | null = null;
  try {
    const form = await req.formData();
    const value = form.get("photo");
    file = value instanceof File ? value : null;
  } catch {
    throw new AppError("VALIDATION_ERROR", "请使用表单字段 photo 上传一张图片");
  }
  if (!file) throw new AppError("VALIDATION_ERROR", "请选择一张照片");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("UPLOAD_TOO_LARGE", "图片超过 15 MB，请压缩后再上传");
  const result = await uploadPhoto({ visitorId: visitor.id, bytes: Buffer.from(await file.arrayBuffer()) });
  return { status: 201, data: result };
});
