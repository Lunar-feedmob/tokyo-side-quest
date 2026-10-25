import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { capabilities, env } from "../config/env";
import { AppError } from "../http/errors";

// Private object storage. Keys are server-generated random paths; the bucket is
// never public. Reads go through our own endpoints or short-lived signed URLs.

const globalForS3 = globalThis as unknown as { tsqS3?: S3Client };

function client(): S3Client {
  const e = env();
  if (!capabilities(e).storage.configured) {
    throw new AppError("STORAGE_UNAVAILABLE", "对象存储未配置");
  }
  if (!globalForS3.tsqS3) {
    globalForS3.tsqS3 = new S3Client({
      endpoint: e.STORAGE_ENDPOINT,
      region: e.STORAGE_REGION,
      forcePathStyle: e.STORAGE_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: e.STORAGE_ACCESS_KEY_ID!, secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY! },
    });
  }
  return globalForS3.tsqS3;
}

function bucket(): string {
  return env().STORAGE_BUCKET!;
}

function wrap(error: unknown): never {
  if (error instanceof AppError) throw error;
  console.error("[storage]", error instanceof Error ? error.message : error);
  throw new AppError("STORAGE_UNAVAILABLE", "存储服务暂时不可用，请稍后重试");
}

export async function ensureBucket(): Promise<void> {
  const s3 = client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket() })).catch(wrap);
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await client().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
    );
  } catch (error) {
    wrap(error);
  }
}

export async function getObject(key: string): Promise<Buffer> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!res.Body) throw new Error(`empty body for ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (error) {
    wrap(error);
  }
}

export async function deleteObjects(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    for (let i = 0; i < unique.length; i += 1000) {
      await client().send(
        new DeleteObjectsCommand({
          Bucket: bucket(),
          Delete: { Objects: unique.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  } catch (error) {
    wrap(error);
  }
}

/** Short-lived read URL (default 5 min). Never persisted; re-signed on demand. */
export async function signedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  try {
    return await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
      expiresIn: expiresInSeconds,
    });
  } catch (error) {
    wrap(error);
  }
}
