import { and, eq } from "drizzle-orm";
import { db } from "@tsq/core/db/client";
import { assets } from "@tsq/core/db/schema";
import { AppError } from "@tsq/core/http/errors";
import { getObject } from "@tsq/core/storage/s3";
import { route } from "@/lib/server/api";

export const GET = route<{ key: string }>(async ({ params }) => {
  if (!/^[a-z0-9-]+--(match|unclear|other)$/u.test(params.key)) throw new AppError("NOT_FOUND", "没有这个样例");
  const [asset] = await db()
    .select()
    .from(assets)
    .where(and(eq(assets.objectKey, `sample/${params.key}/main.jpg`), eq(assets.kind, "sample")))
    .limit(1);
  if (!asset) throw new AppError("NOT_FOUND", "没有这个样例");
  const bytes = await getObject(asset.thumbKey ?? asset.objectKey);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
});
