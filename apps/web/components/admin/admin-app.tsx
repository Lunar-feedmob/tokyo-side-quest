"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, errorText } from "@/lib/client/api";
import { tokyoDateTime } from "@/lib/client/format";
import { PlacesAdmin } from "./places-admin";
import { QuestsAdmin } from "./quests-admin";

interface Admin {
  id: string;
  username: string;
  role: "owner" | "editor" | "reviewer";
}

const TABS = [
  ["reviews", "人工复核", "review"],
  ["places", "地点与参考图", "content"],
  ["quests", "故事", "content"],
  ["ai", "AI 任务", "content"],
  ["health", "系统状态", "content"],
  ["audit", "操作日志", "owner"],
] as const;
const RANK = { reviewer: 1, editor: 2, owner: 3 } as const;
const NEED = { review: 1, content: 2, owner: 3 } as const;

export function AdminApp() {
  const params = useSearchParams();
  const router = useRouter();
  const [admin, setAdmin] = useState<Admin | null | undefined>(undefined);
  const tab = params.get("tab") ?? "reviews";

  useEffect(() => {
    apiGet<{ admin: Admin }>("/admin/session")
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(null));
  }, []);

  if (admin === undefined) return <p className="text-muted">加载中…</p>;
  if (admin === null) return <Login onDone={setAdmin} />;

  const visible = TABS.filter(([, , need]) => RANK[admin.role] >= NEED[need]);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">内容管理后台</p>
          <h1 className="serif text-2xl font-bold">东京支线 · 管理</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>
            {admin.username}（{admin.role}）
          </span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void apiDelete("/admin/session").then(() => setAdmin(null))}
          >
            退出
          </button>
        </div>
      </header>
      <nav role="tablist" className="flex flex-wrap gap-1 rounded-full bg-paper-2 p-1">
        {visible.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            type="button"
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${tab === key ? "bg-white shadow-sm" : "text-ink-2"}`}
            onClick={() => router.replace(`/admin?tab=${key}`)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "reviews" && <Reviews />}
      {tab === "places" && <PlacesAdmin />}
      {tab === "quests" && <QuestsAdmin />}
      {tab === "ai" && <AiCalls />}
      {tab === "health" && <Health />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function Login({ onDone }: { onDone: (a: Admin) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card mx-auto max-w-sm space-y-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        apiPost<{ admin: Admin }>("/admin/session", { username, password })
          .then((r) => onDone(r.admin))
          .catch((err) => setError(errorText(err)))
          .finally(() => setBusy(false));
      }}
    >
      <h1 className="serif text-xl font-bold">管理员登录</h1>
      <div className="space-y-1">
        <label htmlFor="u" className="text-sm font-semibold">
          用户名
        </label>
        <input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-lg border border-rule px-3 py-2" required />
      </div>
      <div className="space-y-1">
        <label htmlFor="p" className="text-sm font-semibold">
          密码
        </label>
        <input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-rule px-3 py-2" required />
      </div>
      {error && <p role="alert" className="notice notice-danger text-sm">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        登录
      </button>
      <p className="text-xs text-muted">管理员账号通过服务器上的 pnpm admin:create 创建。</p>
    </form>
  );
}

interface ReviewItem {
  id: string;
  status: string;
  note: string | null;
  reason: string | null;
  createdAt: string;
  placeNameZh: string;
}
interface ReviewDetail {
  review: { id: string; status: string; note: string | null };
  attempt: { id: string; verificationStatus: string; cancelled: boolean };
  place: { nameZh: string; nameJa: string };
  features: string[];
  verifications: { id: string; source: string; verdict: string; userMessage: string; evidence: { feature: string; relation: string; observation: string }[]; reviewReason: string | null; createdAt: string }[];
  references: { id: string; viewNote: string; imageUrl: string }[];
  photoUrl: string;
}

function Reviews() {
  const [status, setStatus] = useState<"open" | "approved" | "rejected">("open");
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => {
    apiGet<{ items: ReviewItem[] }>(`/admin/reviews?status=${status}`).then((r) => setItems(r.items));
  }, [status]);
  useEffect(load, [load]);
  return (
    <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
      <div className="space-y-3">
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-full rounded-lg border border-rule px-3 py-2" aria-label="复核状态">
          <option value="open">待处理</option>
          <option value="approved">已通过</option>
          <option value="rejected">已拒绝</option>
        </select>
        {items?.length === 0 && <p className="text-sm text-muted">没有记录。</p>}
        <ul className="space-y-2">
          {items?.map((r) => (
            <li key={r.id}>
              <button type="button" className={`card w-full p-3 text-left ${selected === r.id ? "border-ink" : ""}`} onClick={() => setSelected(r.id)}>
                <span className="block font-semibold">{r.placeNameZh}</span>
                <span className="text-xs text-muted">{tokyoDateTime(r.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {selected ? <ReviewPanel id={selected} onDecided={load} /> : <p className="text-muted">选择一条复核请求。</p>}
    </div>
  );
}

function ReviewPanel({ id, onDecided }: { id: string; onDecided: () => void }) {
  const [d, setD] = useState<ReviewDetail | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    apiGet<ReviewDetail>(`/admin/reviews/${id}`).then(setD).catch((e) => setMsg(errorText(e)));
  }, [id]);
  useEffect(load, [load]);
  async function decide(decision: "approve" | "reject") {
    setMsg(null);
    try {
      await apiPost(`/admin/reviews/${id}/decision`, { decision, reason });
      setReason("");
      load();
      onDecided();
      setMsg(decision === "approve" ? "已通过：打卡已生效，并已排队进行摄影评分。" : "已拒绝。");
    } catch (e) {
      setMsg(errorText(e));
    }
  }
  if (!d) return <p className="text-muted">{msg ?? "加载中…"}</p>;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">
        {d.place.nameZh} <span className="text-sm font-normal text-ink-2">{d.place.nameJa}</span>
      </h2>
      <p className="text-xs text-muted">查看照片会记录在操作日志中。只在复核需要时查看。</p>
      <div className="grid gap-3 md:grid-cols-2">
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-only photo */}
          <img src={d.photoUrl} alt="用户照片" className="w-full rounded-lg border border-rule" />
          <figcaption className="text-xs text-muted">用户照片</figcaption>
        </figure>
        <div className="grid grid-cols-2 gap-2">
          {d.references.map((r) => (
            <figure key={r.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- reference image */}
              <img src={r.imageUrl} alt={r.viewNote} className="aspect-[4/3] w-full rounded object-cover" />
              <figcaption className="line-clamp-2 text-[11px] text-muted">{r.viewNote}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <div className="text-sm">
        <p className="font-semibold">可辨识特征</p>
        <ul className="list-disc pl-5 text-ink-2">
          {d.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <div className="space-y-2 text-sm">
        <p className="font-semibold">核验记录</p>
        {d.verifications.map((v) => (
          <div key={v.id} className="notice">
            <p>
              <span className="chip">{v.source}</span> {v.verdict} · {v.userMessage}
            </p>
            {v.evidence.map((e, i) => (
              <p key={i} className="text-xs text-ink-2">
                [{e.relation}] {e.feature}：{e.observation}
              </p>
            ))}
            {v.reviewReason && <p className="text-xs">理由：{v.reviewReason}</p>}
          </div>
        ))}
      </div>
      {d.review.note && <p className="text-sm">用户备注：{d.review.note}</p>}
      {d.review.status === "open" ? (
        <div className="space-y-2">
          <label htmlFor="reason" className="text-sm font-semibold">
            理由（必填）
          </label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-rule p-2" rows={3} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={reason.trim().length < 2} onClick={() => void decide("approve")}>
              通过（地点一致）
            </button>
            <button type="button" className="btn btn-secondary" disabled={reason.trim().length < 2} onClick={() => void decide("reject")}>
              拒绝
            </button>
          </div>
        </div>
      ) : (
        <p className="notice text-sm">状态：{d.review.status}</p>
      )}
      {msg && <p role="status" className="notice notice-info text-sm">{msg}</p>}
    </div>
  );
}

function AiCalls() {
  const [data, setData] = useState<{
    summary: { total: number; failed: number; p50: number | null; p95: number | null; cost: number | null };
    calls: { id: string; stage: string; provider: string; model: string; status: string; errorCode: string | null; latencyMs: number; promptVersion: string; createdAt: string; estimatedCostUsd: number | null }[];
    failedAttempts: { id: string; errorCode: string | null; errorStage: string | null; updatedAt: string }[];
  } | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  useEffect(() => {
    apiGet<NonNullable<typeof data>>(`/admin/ai-calls?hours=168${onlyFailed ? "&failed=1" : ""}`).then(setData);
  }, [onlyFailed]);
  if (!data) return <p className="text-muted">加载中…</p>;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        近 7 天：调用 {s.total} 次，失败 {s.failed} 次，耗时 p50 {s.p50 ? Math.round(s.p50) : "–"} ms / p95 {s.p95 ? Math.round(s.p95) : "–"} ms，
        费用 {s.cost === null ? "未知（提供方未返回）" : `$${s.cost.toFixed(4)}`}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> 只看失败
      </label>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th className="p-2">时间</th>
              <th className="p-2">阶段</th>
              <th className="p-2">模型</th>
              <th className="p-2">状态</th>
              <th className="p-2">错误</th>
              <th className="p-2">耗时</th>
            </tr>
          </thead>
          <tbody>
            {data.calls.map((c) => (
              <tr key={c.id} className="border-t border-rule">
                <td className="p-2">{tokyoDateTime(c.createdAt)}</td>
                <td className="p-2">{c.stage}</td>
                <td className="p-2">
                  {c.provider}/{c.model} · {c.promptVersion}
                </td>
                <td className="p-2">{c.status}</td>
                <td className="p-2">{c.errorCode ?? "–"}</td>
                <td className="p-2">{c.latencyMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-semibold">失败的照片任务（{data.failedAttempts.length}）</p>
      <ul className="text-sm">
        {data.failedAttempts.map((a) => (
          <li key={a.id}>
            {tokyoDateTime(a.updatedAt)} · {a.errorStage} · {a.errorCode}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Health() {
  const [data, setData] = useState<{ ready: boolean; checks: Record<string, { ok: boolean; error?: string }>; missing: { ai: string[]; storage: string[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<NonNullable<typeof data>>("/admin/health").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "加载失败"));
  }, []);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!data) return <p className="text-muted">加载中…</p>;
  return (
    <div className="space-y-3">
      <p className={`notice ${data.ready ? "notice-ok" : "notice-warn"}`}>{data.ready ? "核心依赖就绪" : "部分核心依赖未就绪"}</p>
      <ul className="space-y-1 text-sm">
        {Object.entries(data.checks).map(([k, v]) => (
          <li key={k}>
            <span className={`chip ${v.ok ? "chip-ok" : "chip-danger"}`}>{v.ok ? "正常" : "异常"}</span> {k}
            {v.error && <span className="text-muted"> · {v.error}</span>}
          </li>
        ))}
      </ul>
      {data.missing.ai.length > 0 && <p className="text-sm">AI 缺少配置：{data.missing.ai.join(", ")}</p>}
    </div>
  );
}

function Audit() {
  const [items, setItems] = useState<{ id: string; actorType: string; action: string; targetType: string; targetId: string | null; reason: string | null; createdAt: string }[] | null>(null);
  useEffect(() => {
    apiGet<{ items: NonNullable<typeof items> }>("/admin/audit").then((r) => setItems(r.items));
  }, []);
  if (!items) return <p className="text-muted">加载中…</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((a) => (
        <li key={a.id} className="border-b border-rule py-1">
          {tokyoDateTime(a.createdAt)} · {a.actorType} · <strong>{a.action}</strong> · {a.targetType} {a.targetId?.slice(0, 8)}
          {a.reason && ` · ${a.reason}`}
        </li>
      ))}
    </ul>
  );
}
