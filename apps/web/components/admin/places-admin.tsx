"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, errorText } from "@/lib/client/api";

interface PlaceRow {
  id: string;
  slug: string;
  nameZh: string;
  status: string;
  radiusM: number;
  photoEnabled: boolean;
  publishedVersion: number | null;
  referenceCount: number;
}
interface PlaceDetail {
  place: {
    id: string;
    slug: string;
    nameZh: string;
    nameJa: string;
    nameEn: string | null;
    status: string;
    radiusM: number;
    photoEnabled: boolean;
    latitude: number;
    longitude: number;
    tags: string[];
    stayMinutes: number | null;
    draft: unknown;
  };
  references: { id: string; viewNote: string; author: string; license: string; sourceUrl: string | null; status: string; publicDisplay: boolean; imageUrl: string }[];
  versions: { id: string; version: number; publishedAt: string; photoEnabled: boolean; referenceVersion: string }[];
}

export function PlacesAdmin() {
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => {
    apiGet<{ items: PlaceRow[] }>("/admin/places").then((r) => setRows(r.items));
  }, []);
  useEffect(load, [load]);
  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <ul className="space-y-2">
        {rows?.map((p) => (
          <li key={p.id}>
            <button type="button" className={`card w-full p-3 text-left ${selected === p.id ? "border-ink" : ""}`} onClick={() => setSelected(p.id)}>
              <span className="block font-semibold">{p.nameZh}</span>
              <span className="text-xs text-muted">
                {p.status} · v{p.publishedVersion ?? "-"} · 参考图 {p.referenceCount} · {p.photoEnabled ? "照片核验开" : "仅定位"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? <PlaceEditor id={selected} onChanged={load} /> : <p className="text-muted">选择一个地点。新增地点可以通过 POST /api/v1/admin/places 或种子内容文件。</p>}
    </div>
  );
}

function PlaceEditor({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [d, setD] = useState<PlaceDetail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    apiGet<PlaceDetail>(`/admin/places/${id}`).then((r) => {
      setD(r);
      setForm({
        nameZh: r.place.nameZh,
        nameJa: r.place.nameJa,
        latitude: String(r.place.latitude),
        longitude: String(r.place.longitude),
        radiusM: String(r.place.radiusM),
        status: r.place.status,
        photoEnabled: String(r.place.photoEnabled),
      });
      setContent(JSON.stringify(r.place.draft, null, 2));
    });
  }, [id]);
  useEffect(load, [load]);

  async function save() {
    setMsg(null);
    try {
      const body = {
        nameZh: form.nameZh,
        nameJa: form.nameJa,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusM: Number(form.radiusM),
        photoEnabled: form.photoEnabled === "true",
        status: form.status,
        content: JSON.parse(content),
      };
      const r = await apiPatch<{ affectedActiveRuns: number }>(`/admin/places/${id}`, body);
      setMsg({ ok: true, text: `已保存草稿。${r.affectedActiveRuns ? `注意：有 ${r.affectedActiveRuns} 个进行中的故事经过这个地点，相关任务会显示暂停。` : ""}发布新版本后用户才能看到内容修改。` });
      load();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SyntaxError ? "内容 JSON 格式不正确" : errorText(e) });
    }
  }
  async function publish() {
    setMsg(null);
    try {
      const r = await apiPost<{ version: number; photoEnabled: boolean; referenceCount: number }>(`/admin/places/${id}/publish`);
      setMsg({ ok: true, text: `已发布 v${r.version}：参考图 ${r.referenceCount} 张，照片核验${r.photoEnabled ? "已开启" : "未开启（需要至少 3 张授权参考图和可辨识特征）"}` });
      load();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  }

  if (!d) return <p className="text-muted">加载中…</p>;
  const field = (key: string, label: string, type = "text") => (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold">{label}</span>
      <input type={type} value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="w-full rounded border border-rule px-2 py-1.5" />
    </label>
  );
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold">
        {d.place.nameZh} <span className="text-sm text-muted">{d.place.slug}</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("nameZh", "中文名")}
        {field("nameJa", "日文名")}
        {field("latitude", "纬度 latitude (WGS84)")}
        {field("longitude", "经度 longitude (WGS84)")}
        {field("radiusM", "有效半径（米）", "number")}
        <label className="block space-y-1 text-sm">
          <span className="font-semibold">状态</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full rounded border border-rule px-2 py-1.5">
            {["draft", "published", "temporarily_closed", "archived"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.photoEnabled === "true"} onChange={(e) => setForm({ ...form, photoEnabled: String(e.target.checked) })} />
          允许照片核验（发布时还需满足参考图条件）
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">内容（JSON：介绍、文化观察与来源、特征、易混淆地点、限制、坐标来源）</span>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={14} className="w-full rounded border border-rule p-2 font-mono text-xs" />
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void save()}>
          保存草稿
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void publish()}>
          发布新版本
        </button>
      </div>
      {msg && <p className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>{msg.text}</p>}

      <section className="space-y-2">
        <h3 className="font-bold">参考图库</h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {d.references.map((r) => (
            <li key={r.id} className="space-y-1 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- reference image */}
              <img src={r.imageUrl} alt={r.viewNote} className={`aspect-[4/3] w-full rounded object-cover ${r.status !== "active" ? "opacity-40" : ""}`} />
              <p className="line-clamp-2">{r.viewNote}</p>
              <p className="text-muted">
                {r.author} ·{" "}
                {r.sourceUrl ? (
                  <a href={r.sourceUrl} className="underline" target="_blank" rel="noreferrer">
                    {r.license}
                  </a>
                ) : (
                  r.license
                )}
                {r.publicDisplay ? " · 可公开展示" : " · 仅内部核验"}
              </p>
              {r.status === "active" ? (
                <button type="button" className="underline" onClick={() => void apiDelete(`/admin/references/${r.id}`).then(load)}>
                  停用
                </button>
              ) : (
                <span className="text-muted">已停用</span>
              )}
            </li>
          ))}
        </ul>
        <ReferenceUpload placeId={id} onDone={load} />
      </section>

      <section className="space-y-1 text-sm">
        <h3 className="font-bold">已发布版本</h3>
        {d.versions.map((v) => (
          <p key={v.id}>
            v{v.version} · {new Date(v.publishedAt).toLocaleString("zh-CN")} · {v.referenceVersion} · {v.photoEnabled ? "照片核验" : "仅定位"}
          </p>
        ))}
      </section>
    </div>
  );
}

function ReferenceUpload({ placeId, onDone }: { placeId: string; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="card space-y-2 p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        const form = new FormData(e.currentTarget);
        form.set("publicDisplay", form.get("publicDisplay") ? "true" : "false");
        form.set("aiGenerated", "false");
        const res = await fetch(`/api/v1/admin/places/${placeId}/references`, { method: "POST", body: form, credentials: "same-origin" });
        const body = await res.json();
        if (!res.ok) setMsg(body.error?.message ?? "上传失败");
        else {
          setMsg(body.data.note);
          (e.target as HTMLFormElement).reset();
          onDone();
        }
      }}
    >
      <p className="font-semibold">添加参考图（必须是真实照片并记录授权；AI 生成图不能作为核验参考）</p>
      <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required />
      <input name="viewNote" placeholder="取景说明" required className="w-full rounded border border-rule px-2 py-1" />
      <input name="sourceUrl" placeholder="来源页面 URL（项目自己拍的照片留空）" type="url" className="w-full rounded border border-rule px-2 py-1" />
      <div className="grid grid-cols-2 gap-2">
        <input name="author" placeholder="作者" required className="rounded border border-rule px-2 py-1" />
        <input name="license" placeholder="许可，如 CC BY 4.0 / 自摄" required className="rounded border border-rule px-2 py-1" />
      </div>
      <input name="usageBasis" placeholder="使用依据（许可条款或授权说明）" required className="w-full rounded border border-rule px-2 py-1" />
      <input name="capturedOn" placeholder="拍摄日期（可选）" className="w-full rounded border border-rule px-2 py-1" />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="publicDisplay" /> 授权允许在地点页公开展示
      </label>
      <button type="submit" className="btn btn-secondary">
        上传
      </button>
      {msg && <p className="text-xs">{msg}</p>}
    </form>
  );
}
