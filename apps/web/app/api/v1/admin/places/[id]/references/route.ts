import { AppError } from "@tsq/core/http/errors";
import { adminAddReference, referenceUploadSchema } from "@tsq/core/services/admin";
import { route } from "@/lib/server/api";
import { requireAdmin } from "@/lib/server/admin";

export const POST = route<{ id: string }>(async ({ req, params }) => {
  const admin = await requireAdmin("content");
  const form = await req.formData().catch(() => {
    throw new AppError("VALIDATION_ERROR", "请使用表单上传");
  });
  const file = form.get("photo");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "缺少图片");
  const meta = referenceUploadSchema.parse({
    viewNote: form.get("viewNote"),
    sourceUrl: (form.get("sourceUrl") as string | null) || null,
    author: form.get("author"),
    license: form.get("license"),
    usageBasis: form.get("usageBasis"),
    publicDisplay: form.get("publicDisplay") === "true",
    capturedOn: (form.get("capturedOn") as string | null) || null,
    aiGenerated: form.get("aiGenerated") === "true",
  });
  return { status: 201, data: await adminAddReference(admin, params.id, Buffer.from(await file.arrayBuffer()), meta) };
});
