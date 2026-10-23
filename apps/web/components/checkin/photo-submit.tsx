"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCapabilities } from "@/components/env-banner";
import { ApiError, apiPost, ensureSession, errorText, uploadWithProgress } from "@/lib/client/api";
import { geoMessage, useGeolocation } from "@/lib/client/use-geolocation";

// Photo submission (spec §4.5): choose → preview → explicit submit. Nothing is
// uploaded or sent to AI until the user presses submit, and a double click
// cannot create two attempts (one idempotency key per selected photo).

const ACCEPT = "image/jpeg,image/png,image/webp";
const CLIENT_LONG_EDGE = 2048;

type Phase = { kind: "idle" } | { kind: "uploading"; fraction: number } | { kind: "submitting" } | { kind: "error"; message: string };

async function shrink(file: File): Promise<Blob> {
  // Downscale large photos in the browser to cut upload time; the server still validates and normalises.
  if (file.size < 2.5 * 1024 * 1024 || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, CLIENT_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

function looksLikeHeic(file: File) {
  return /hei[cf]$/iu.test(file.type) || /\.(heic|heif)$/iu.test(file.name);
}

export function PhotoSubmit(props: {
  place: { id: string; nameZh: string; nameJa: string };
  quest?: { runId: string; stepId: string; title?: string } | null;
}) {
  const router = useRouter();
  const caps = useCapabilities();
  const cameraInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [attachLocation, setAttachLocation] = useState(false);
  const geo = useGeolocation();
  const attemptKey = useRef<string>("");
  const uploaded = useRef<{ fileRef: File; assetId: string } | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | undefined) {
    setNotice(null);
    setPhase({ kind: "idle" });
    if (!f) return;
    if (looksLikeHeic(f)) {
      setNotice("暂不支持 HEIC/HEIF 格式。iPhone 可在“设置 › 相机 › 格式”中选择“兼容性最佳”，或先把照片转换为 JPEG 再上传。");
      return;
    }
    if (f.type && !ACCEPT.split(",").includes(f.type)) {
      setNotice("仅支持 JPEG、PNG、WebP 照片。");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    attemptKey.current = crypto.randomUUID().replace(/-/gu, "");
    uploaded.current = null;
  }

  async function submit() {
    if (!file || phase.kind === "uploading" || phase.kind === "submitting") return;
    try {
      await ensureSession();
      let assetId = uploaded.current?.fileRef === file ? uploaded.current.assetId : null;
      if (!assetId) {
        setPhase({ kind: "uploading", fraction: 0 });
        const blob = await shrink(file);
        const form = new FormData();
        form.append("photo", blob, file.name.replace(/\.[^.]+$/u, "") + (blob === file ? "" : ".jpg"));
        const up = await uploadWithProgress<{ assetId: string }>("/photos", form, (fraction) =>
          setPhase({ kind: "uploading", fraction }),
        );
        assetId = up.assetId;
        uploaded.current = { fileRef: file, assetId };
      }
      setPhase({ kind: "submitting" });
      // Optional, user-chosen: attach the current device reading as extra evidence.
      const position = attachLocation ? await geo.locate() : null;
      const r = await apiPost<{ attemptId: string }>(
        "/photo-attempts",
        {
          placeId: props.place.id,
          assetId,
          questRunId: props.quest?.runId ?? null,
          questStepId: props.quest?.stepId ?? null,
          position,
        },
        { key: attemptKey.current },
      );
      router.push(`/attempts/${r.attemptId}`);
    } catch (e) {
      const message = e instanceof ApiError && e.code === "AI_NOT_CONFIGURED" ? e.message : errorText(e);
      setPhase({ kind: "error", message });
    }
  }

  const aiUnavailable = caps !== null && !caps.ai.available;
  const busy = phase.kind === "uploading" || phase.kind === "submitting";

  return (
    <div className="space-y-5">
      <div className="ticket space-y-1 p-4">
        <p className="eyebrow">目标地点</p>
        <p className="text-xl font-bold">{props.place.nameZh}</p>
        <p className="text-sm text-ink-2" lang="ja">
          {props.place.nameJa}
        </p>
        {props.quest?.title && <p className="pt-1 text-sm text-line-green">故事任务：{props.quest.title}</p>}
      </div>

      <p className="notice notice-info text-sm">
        <strong>先核对地点，再评价摄影表现。</strong>
        照片会发送给 AI 服务，用于地点核验和摄影建议；照片默认只有你能看到。相册里的旧照片也可能通过地点核验，但这不代表你此刻在现场。
      </p>

      {aiUnavailable && (
        <p className="notice notice-warn text-sm">
          照片核验服务暂未开通，现在提交不会得到结果。你可以先使用定位打卡，或去
          <Link href="/demo" className="underline">
            在线试玩
          </Link>
          体验完整流程。
        </p>
      )}

      <input ref={cameraInput} type="file" accept={ACCEPT} capture="environment" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} tabIndex={-1} aria-hidden />
      <input ref={albumInput} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => choose(e.target.files?.[0])} tabIndex={-1} aria-hidden />

      {!preview ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className="btn btn-primary" onClick={() => cameraInput.current?.click()}>
            拍一张照片
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => albumInput.current?.click()}>
            从相册选择
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img src={preview} alt="待提交的照片预览" className="max-h-[60vh] w-full rounded-xl border border-rule bg-paper-2 object-contain" />
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => albumInput.current?.click()}>
              更换照片
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={busy || aiUnavailable} onClick={() => void submit()}>
              {phase.kind === "uploading"
                ? `上传中 ${Math.round(phase.fraction * 100)}%`
                : phase.kind === "submitting"
                  ? "正在提交…"
                  : "提交核验"}
            </button>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={attachLocation} onChange={(e) => setAttachLocation(e.target.checked)} disabled={busy} />
            <span>
              同时附带当前位置（可选）。若设备位置在范围内，结果会标为“照片匹配 · 位置符合范围”；不附带也不影响照片核验。
            </span>
          </label>
          {attachLocation && geoMessage(geo.state) && <p className="text-xs text-warn">{geoMessage(geo.state)}（照片仍会照常提交）</p>}
          {phase.kind === "uploading" && (
            <div className="h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-label="上传进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.fraction * 100)}>
              <div className="h-full bg-line-green transition-[width]" style={{ width: `${Math.round(phase.fraction * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {notice && <p className="notice notice-warn text-sm">{notice}</p>}
      {phase.kind === "error" && (
        <div role="alert" className="notice notice-danger text-sm">
          <p>{phase.message}</p>
          <button type="button" className="underline" onClick={() => void submit()}>
            重试
          </button>
        </div>
      )}
    </div>
  );
}
