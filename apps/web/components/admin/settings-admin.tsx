"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost, errorText } from "@/lib/client/api";
import { tokyoDateTime } from "@/lib/client/format";

type Provider = "anthropic" | "openai-compatible";
type Source = "settings" | "env" | "none";

interface SettingsView {
  ai: {
    effective: { source: Source; configured: boolean; provider: string | null; model: string | null; baseUrl: string | null; missing: string[]; problem: string | null };
    saved: { provider: Provider; baseUrl: string | null; model: string; timeoutMs: number; apiKeyHint: string; updatedAt: string } | null;
    env: { configured: boolean; provider: string | null; model: string | null };
  };
  map: {
    effective: { source: Source; configured: boolean };
    saved: { provider: "maptiler"; style: string; apiKey: string; updatedAt: string } | null;
    styles: string[];
  };
}

interface TestResult {
  ok: boolean;
  model: string | null;
  latencyMs: number;
  code: string | null;
  message: string;
}

const SOURCE_LABEL: Record<Source, string> = { settings: "后台设置", env: "环境变量（.env）", none: "未配置" };

const PROVIDERS: Record<Provider, { label: string; baseUrlHint: string; modelHint: string }> = {
  anthropic: {
    label: "Anthropic 协议",
    baseUrlHint: "Messages API。留空即官方地址 https://api.anthropic.com；用代理或网关时填它的根地址",
    modelHint: "例如 claude-opus-5-5",
  },
  "openai-compatible": {
    label: "OpenAI 兼容协议",
    baseUrlHint: "必填，调用其下的 /chat/completions。通常以 /v1 结尾，例如 https://api.openai.com/v1",
    modelHint: "需支持图片输入和 JSON Schema 结构化输出",
  },
};

/** Validation errors carry per-field messages; show them instead of the generic one. */
function describe(error: unknown): string {
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
    const issues = (error.details?.issues as { message: string }[] | undefined) ?? [];
    if (issues.length) return issues.map((i) => i.message).join("；");
  }
  return errorText(error);
}

export function SettingsAdmin() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiGet<SettingsView>("/admin/settings").then(setView).catch((e) => setError(describe(e)));
  }, []);
  useEffect(load, [load]);
  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!view) return <p className="text-muted">加载中…</p>;
  return (
    <div className="space-y-8">
      <AiSettings view={view} onSaved={setView} />
      <MapSettings view={view} onSaved={setView} />
    </div>
  );
}

function Field(props: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="text-sm font-semibold">
        {props.label}
      </label>
      {props.children}
      {props.hint && <p className="text-xs text-muted">{props.hint}</p>}
    </div>
  );
}

const INPUT = "w-full rounded-lg border border-rule px-3 py-2";

function AiSettings({ view, onSaved }: { view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const saved = view.ai.saved;
  const [provider, setProvider] = useState<Provider>(saved?.provider ?? "anthropic");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [model, setModel] = useState(saved?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [timeoutSec, setTimeoutSec] = useState(String((saved?.timeoutMs ?? 45_000) / 1000));
  const [busy, setBusy] = useState<null | "save" | "test" | "clear">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const body = () => ({ provider, baseUrl, model, apiKey, timeoutMs: Math.round(Number(timeoutSec) * 1000) });
  async function run(kind: "save" | "test" | "clear") {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "test") {
        const r = await apiPost<TestResult>("/admin/settings/ai/test", body());
        setMsg(r.ok ? { ok: true, text: `${r.message}（${r.model}，${r.latencyMs} ms）` } : { ok: false, text: `测试失败 · ${r.code}：${r.message}` });
      } else if (kind === "save") {
        onSaved(await apiPost<SettingsView>("/admin/settings/ai", body()));
        setApiKey("");
        setMsg({ ok: true, text: "已保存。网站立即生效，后台任务最多 10 秒内生效。" });
      } else {
        onSaved(await apiDelete<SettingsView>("/admin/settings/ai"));
        setMsg({ ok: true, text: "已清除后台设置。" });
      }
    } catch (e) {
      setMsg({ ok: false, text: describe(e) });
    } finally {
      setBusy(null);
    }
  }

  const eff = view.ai.effective;
  const p = PROVIDERS[provider];
  return (
    <section className="card space-y-4 p-5" aria-labelledby="ai-settings">
      <div>
        <h2 id="ai-settings" className="text-lg font-bold">
          照片核验 · 视觉 AI
        </h2>
        <p className={`notice mt-2 text-sm ${eff.configured ? "notice-ok" : "notice-warn"}`}>
          {eff.configured
            ? `当前生效：${SOURCE_LABEL[eff.source]} · ${eff.provider} / ${eff.model}`
            : `照片核验未开通${eff.problem ? `：${eff.problem}` : "，用户只能用定位打卡和在线试玩"}`}
        </p>
        <p className="mt-1 text-xs text-muted">
          后台设置优先于 .env。{view.ai.env.configured && `.env 里也有配置（${view.ai.env.provider} / ${view.ai.env.model}），清除后台设置后会改用它。`}
          {saved && ` 上次保存：${tokyoDateTime(saved.updatedAt)}。`}
        </p>
      </div>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save");
        }}
      >
        <Field id="ai-provider" label="协议">
          <select id="ai-provider" className={INPUT} value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {(Object.keys(PROVIDERS) as Provider[]).map((k) => (
              <option key={k} value={k}>
                {PROVIDERS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="ai-model" label="模型" hint={p.modelHint}>
          <input id="ai-model" className={INPUT} value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        <Field id="ai-base" label="接口地址" hint={p.baseUrlHint}>
          <input id="ai-base" className={INPUT} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} />
        </Field>
        <Field id="ai-key" label="API Key" hint="加密保存在服务器，之后不会再显示。">
          <input
            id="ai-key"
            type="password"
            className={INPUT}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={saved ? `已保存（${saved.apiKeyHint}），留空则不修改` : "必填"}
            autoComplete="new-password"
            spellCheck={false}
          />
        </Field>
        <Field id="ai-timeout" label="超时（秒）" hint="单次模型请求的上限，5–300 秒。">
          <input id="ai-timeout" type="number" min={5} max={300} className={INPUT} value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void run("test")}>
            {busy === "test" ? "测试中…" : "测试连接"}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>
            保存
          </button>
          {saved && (
            <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={() => void run("clear")}>
              清除后台设置
            </button>
          )}
        </div>
      </form>
      {msg && (
        <p role="status" className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>
          {msg.text}
        </p>
      )}
      <p className="text-xs text-muted">
        “测试连接”会用表单里的值发一次真实请求（一张纯色小图，会产生少量费用），不会保存。更换协议、接口地址或模型后，之前的识别结果不再复用，会重新调用模型。
      </p>
    </section>
  );
}

function MapSettings({ view, onSaved }: { view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const saved = view.map.saved;
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [style, setStyle] = useState(saved?.style ?? "streets-v2");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: "save" | "clear") {
    setBusy(true);
    setMsg(null);
    try {
      onSaved(kind === "save" ? await apiPost<SettingsView>("/admin/settings/map", { apiKey, style }) : await apiDelete<SettingsView>("/admin/settings/map"));
      setMsg({ ok: true, text: kind === "save" ? "已保存，刷新“发现”页即可看到地图。" : "已清除后台设置。" });
    } catch (e) {
      setMsg({ ok: false, text: describe(e) });
    } finally {
      setBusy(false);
    }
  }

  const eff = view.map.effective;
  return (
    <section className="card space-y-4 p-5" aria-labelledby="map-settings">
      <div>
        <h2 id="map-settings" className="text-lg font-bold">
          地图底图 · MapTiler
        </h2>
        <p className={`notice mt-2 text-sm ${eff.configured ? "notice-ok" : "notice-warn"}`}>
          {eff.configured ? `当前生效：${SOURCE_LABEL[eff.source]}` : "地图未开通，“发现”页只显示地点列表"}
        </p>
      </div>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("save");
        }}
      >
        <Field id="map-key" label="API Key" hint="这是浏览器端公开使用的 key，访客能看到。请在 MapTiler 后台把它限制为本站域名（Allowed HTTP origins）。">
          <input id="map-key" className={INPUT} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        <Field id="map-style" label="样式">
          <select id="map-style" className={INPUT} value={style} onChange={(e) => setStyle(e.target.value)}>
            {view.map.styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            保存
          </button>
          {saved && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run("clear")}>
              清除后台设置
            </button>
          )}
        </div>
      </form>
      {msg && (
        <p role="status" className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
