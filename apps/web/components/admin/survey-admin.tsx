"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haversineMeters } from "@tsq/core/domain/location";
import { ApiError, apiDelete, apiGet, apiPost, errorText } from "@/lib/client/api";
import { tokyoDateTime } from "@/lib/client/format";

// Field survey, used on a phone at the place itself (content provenance
// "待办（需实地）"). Records GPS samples and observations, and uploads
// reference photos taken by the surveyor. Nothing here changes what visitors
// see until a new place version is published.

interface PlaceRow {
  id: string;
  slug: string;
  nameZh: string;
  nameJa: string;
  radiusM: number;
  photoEnabled: boolean;
  latitude: number;
  longitude: number;
  referenceCount: number;
}

interface Entry {
  id: string;
  kind: "position" | "note";
  label: string;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  readings: number | null;
  note: string | null;
  distanceM: number | null;
  createdAt: string;
}

interface SurveyView {
  point: { latitude: number; longitude: number; radiusM: number };
  entries: Entry[];
}

const LABELS = { checkpoint: "打卡点", entrance: "入口", edge: "边界", other: "其他" } as const;
type Label = keyof typeof LABELS;

// What to do at each place, from docs/content-provenance.md (gaps found in the desk research).
const TASKS: Record<string, { shots: string[]; positions: string[]; checks: string[] }> = {
  "yanaka-ginza": {
    shots: ["从东端台阶上方俯拍整条街（遮阳篷、灯笼形路灯）", "“谷中ぎんざ”门牌正面", "街道中段平视", "西端入口回望"],
    positions: ["街道中段（打卡点）", "东端门牌下、西端入口（边界）"],
    checks: ["木雕猫是否还在，在哪家店", "有没有禁止拍照的告示"],
  },
  "kannonji-tsuijibei": {
    shots: ["西端视角（目前缺这个角度）", "墙面中段平视，带上瓦顶", "东端石基、石柱和说明牌", "墙上的小木门"],
    positions: ["南侧公共小巷（打卡点），巷子窄，多采几次", "墙的东端、西端（边界）"],
    checks: ["只在公共小巷拍，不进寺院境内"],
  },
  "okakura-tenshin-park": {
    shots: ["整修后的六角堂正面", "六角堂斜侧，带上六角形铺地", "谷中鶯之碑", "“岡倉天心先生宅跡”石柱"],
    positions: ["六角堂前（打卡点）", "公园入口"],
    checks: ["开放时间告示", "整修后有没有新的使用规定"],
  },
  "yuyake-dandan": {
    shots: ["台阶上端往下看，拍到 2026 年新建的 7 层公寓", "台阶下端往上看，带门牌", "台阶中段侧面"],
    positions: ["台阶上端（打卡点）", "台阶下端"],
    checks: ["这里拍够 3 张以上，照片核验才能重新开放"],
  },
  "yomise-dori": {
    shots: ["街道的拱门招牌（如果有）", "能和普通街道区分开的街景"],
    positions: ["打卡点", "街道两端（边界），现在半径 70 米，看看合不合适"],
    checks: ["这条街有没有一眼能认出来的特征；没有的话继续只开放定位打卡"],
  },
  "nezu-shrine": {
    shots: [],
    positions: ["神桥 / 楼门前（打卡点）", "入口鸟居"],
    checks: ["不拍参考图：神社禁止把境内照片当素材分发，也禁止“不参拜只拍照”", "唐门开闭时间告示"],
  },
};

const SAMPLE_SECONDS = 20;

type Sampling =
  | { state: "idle" }
  | { state: "running"; readings: number; best: GeolocationCoordinates | null; endsAt: number }
  | { state: "done"; readings: number; best: GeolocationCoordinates }
  | { state: "error"; message: string };

function geoError(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return "没有定位权限。请在浏览器设置里允许这个网站使用位置，再重试。";
  if (e.code === e.TIMEOUT) return "长时间没有拿到位置。请走到开阔处再试。";
  return "无法获取位置。请确认手机定位已打开。";
}

function useSampler() {
  const [sampling, setSampling] = useState<Sampling>({ state: "idle" });
  const watch = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef<{ readings: number; best: GeolocationCoordinates | null }>({ readings: 0, best: null });

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    if (timer.current !== null) window.clearTimeout(timer.current);
    watch.current = timer.current = null;
    const { readings, best } = latest.current;
    setSampling(best ? { state: "done", readings, best } : { state: "error", message: "这段时间里没有拿到任何位置读数，请再试一次。" });
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setSampling({ state: "error", message: "这个浏览器不支持定位。" });
      return;
    }
    latest.current = { readings: 0, best: null };
    const endsAt = Date.now() + SAMPLE_SECONDS * 1000;
    setSampling({ state: "running", readings: 0, best: null, endsAt });
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const prev = latest.current.best;
        latest.current = {
          readings: latest.current.readings + 1,
          // Keep the most precise reading of the window.
          best: !prev || pos.coords.accuracy < prev.accuracy ? pos.coords : prev,
        };
        setSampling({ state: "running", readings: latest.current.readings, best: latest.current.best, endsAt });
      },
      (e) => {
        if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
        if (timer.current !== null) window.clearTimeout(timer.current);
        watch.current = timer.current = null;
        setSampling({ state: "error", message: geoError(e) });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    timer.current = window.setTimeout(stop, SAMPLE_SECONDS * 1000);
  }, [stop]);

  useEffect(
    () => () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { sampling, start, stop, reset: () => setSampling({ state: "idle" }) };
}

function tokyoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function SurveyAdmin() {
  const [places, setPlaces] = useState<PlaceRow[] | null>(null);
  const [placeId, setPlaceId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const loadPlaces = useCallback(() => {
    apiGet<{ items: PlaceRow[] }>("/admin/places")
      .then(({ items }) => {
        setPlaces(items);
        setPlaceId((cur) => cur || items[0]?.id || "");
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(loadPlaces, [loadPlaces]);

  if (error) return <p className="notice notice-danger">{error}</p>;
  if (!places) return <p className="text-muted">加载中…</p>;
  const place = places.find((p) => p.id === placeId);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm text-ink-2">在现场用手机打开这一页。采到的位置和记录只用来校准坐标和半径；上传的照片要等内容负责人审核、发布新版本后才会用于核验。</p>
        <label htmlFor="survey-place" className="block text-sm font-semibold">
          现在在哪个地点
        </label>
        <select id="survey-place" className="w-full rounded-lg border border-rule px-3 py-2" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nameZh}（{p.nameJa}）
            </option>
          ))}
        </select>
      </div>
      {place && <PlaceSurvey key={place.id} place={place} onReferenceAdded={loadPlaces} />}
    </div>
  );
}

function PlaceSurvey({ place, onReferenceAdded }: { place: PlaceRow; onReferenceAdded: () => void }) {
  const [view, setView] = useState<SurveyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tasks = TASKS[place.slug];

  useEffect(() => {
    apiGet<SurveyView>(`/admin/places/${place.id}/survey`)
      .then(setView)
      .catch((e) => setError(errorText(e)));
  }, [place.id]);

  const checkpoints = view?.entries.filter((e) => e.kind === "position" && e.label === "checkpoint" && e.distanceM !== null) ?? [];
  const meanOffset = checkpoints.length ? Math.round(checkpoints.reduce((s, e) => s + e.distanceM!, 0) / checkpoints.length) : null;

  return (
    <div className="space-y-5">
      <section className="card space-y-2 p-4" aria-labelledby="survey-now">
        <h2 id="survey-now" className="text-lg font-bold">
          {place.nameZh}
        </h2>
        <p className="text-sm text-ink-2">
          当前打卡点 {place.latitude.toFixed(6)}, {place.longitude.toFixed(6)} · 半径 {place.radiusM} m · 照片核验{place.photoEnabled ? "开放" : "关闭"} · 参考图 {place.referenceCount} 张
        </p>
        <p className="text-sm">
          <a className="underline" href={`https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`} target="_blank" rel="noreferrer">
            在地图上看当前打卡点
          </a>
        </p>
        {meanOffset !== null && (
          <p className="text-sm">
            已在打卡点采样 {checkpoints.length} 次，平均离当前打卡点 {meanOffset} m。
          </p>
        )}
      </section>

      {tasks && (
        <section className="space-y-2" aria-labelledby="survey-tasks">
          <h3 id="survey-tasks" className="font-bold">
            这里要做的事
          </h3>
          <TaskList title="补拍参考图" items={tasks.shots.length ? tasks.shots : ["这里不拍参考图"]} />
          <TaskList title="采定位" items={tasks.positions} />
          <TaskList title="现场核实" items={tasks.checks} />
        </section>
      )}

      {error && <p className="notice notice-danger text-sm">{error}</p>}
      <PositionSampler place={place} onSaved={setView} />
      {tasks?.shots.length !== 0 && <SurveyPhoto place={place} onUploaded={onReferenceAdded} />}
      <SurveyNote placeId={place.id} onSaved={setView} />
      {view && <Entries placeId={place.id} view={view} onChange={setView} />}
    </div>
  );
}

function TaskList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="text-sm">
      <p className="font-semibold">{title}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function PositionSampler({ place, onSaved }: { place: PlaceRow; onSaved: (v: SurveyView) => void }) {
  const { sampling, start, stop, reset } = useSampler();
  const [label, setLabel] = useState<Label>("checkpoint");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sampling.state !== "running") return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [sampling.state]);

  const best = sampling.state === "running" || sampling.state === "done" ? sampling.best : null;
  const distance = best ? Math.round(haversineMeters(place, { latitude: best.latitude, longitude: best.longitude })) : null;

  async function save() {
    if (sampling.state !== "done") return;
    setBusy(true);
    setMsg(null);
    try {
      const v = await apiPost<SurveyView>(`/admin/places/${place.id}/survey`, {
        kind: "position",
        label,
        latitude: sampling.best.latitude,
        longitude: sampling.best.longitude,
        accuracyM: Math.round(sampling.best.accuracy * 10) / 10,
        readings: sampling.readings,
        note: note || undefined,
      });
      onSaved(v);
      setNote("");
      reset();
      setMsg({ ok: true, text: `已保存（${LABELS[label]}）。` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="survey-position">
      <h3 id="survey-position" className="font-bold">
        采定位
      </h3>
      <p className="text-sm text-ink-2">站定不动，点“开始采样”。手机会连续定位 {SAMPLE_SECONDS} 秒，保留最准的一次。</p>
      {sampling.state === "idle" && (
        <button type="button" className="btn btn-primary w-full" onClick={start}>
          开始采样
        </button>
      )}
      {(sampling.state === "running" || sampling.state === "done") && (
        <div role="status" className="space-y-1 rounded-lg bg-paper-2 p-3 text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
          <p>
            {sampling.state === "running" ? `采样中，还剩 ${Math.max(0, Math.ceil((sampling.endsAt - now) / 1000))} 秒` : "采样完成"} · 读数 {sampling.readings} 次
          </p>
          {best ? (
            <>
              <p>
                最佳精度 ±{Math.round(best.accuracy)} m · 离当前打卡点 {distance} m（{distance! <= place.radiusM ? "在半径内" : "在半径外"}）
              </p>
              <p className="text-muted">
                {best.latitude.toFixed(6)}, {best.longitude.toFixed(6)}
              </p>
            </>
          ) : (
            <p className="text-muted">等待第一个读数…</p>
          )}
        </div>
      )}
      {sampling.state === "running" && (
        <button type="button" className="btn btn-secondary w-full" onClick={stop}>
          提前结束
        </button>
      )}
      {sampling.state === "done" && (
        <div className="space-y-3">
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">这是哪里</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LABELS) as Label[]).map((k) => (
                <label key={k} className={`rounded-full border px-3 py-1.5 text-sm ${label === k ? "border-ink bg-paper-2 font-semibold" : "border-rule"}`}>
                  <input type="radio" name="survey-label" value={k} checked={label === k} onChange={() => setLabel(k)} className="sr-only" />
                  {LABELS[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor="survey-position-note" className="block space-y-1 text-sm">
            <span className="font-semibold">备注（可选）</span>
            <input id="survey-position-note" className="w-full rounded-lg border border-rule px-3 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：门牌正下方、巷子最窄处" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void save()}>
              保存这个位置
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={reset}>
              不要了
            </button>
          </div>
        </div>
      )}
      {sampling.state === "error" && (
        <div className="space-y-2">
          <p className="notice notice-warn text-sm">{sampling.message}</p>
          <button type="button" className="btn btn-secondary w-full" onClick={start}>
            重新采样
          </button>
        </div>
      )}
      {msg && (
        <p role="status" className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function SurveyPhoto({ place, onUploaded }: { place: PlaceRow; onUploaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section className="card space-y-3 p-4" aria-labelledby="survey-photo">
      <h3 id="survey-photo" className="font-bold">
        拍参考图
      </h3>
      <p className="text-sm text-ink-2">横拍，拍全上面列的特征；避开行人和店员的正脸。一个角度一张，分别上传。</p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const data = new FormData(formEl);
          const photographer = String(data.get("photographer") ?? "").trim();
          const publicOk = data.get("publicDisplay") === "on";
          const form = new FormData();
          form.set("photo", data.get("photo") as File);
          form.set("viewNote", String(data.get("viewNote") ?? "").trim());
          form.set("author", photographer);
          form.set("license", "自摄");
          form.set("usageBasis", `拍摄者授权东京支线项目用作地点核验参考图${publicOk ? "，并允许署名公开展示" : ""}（实地踏勘 ${tokyoToday()}）`);
          form.set("publicDisplay", publicOk ? "true" : "false");
          form.set("capturedOn", tokyoToday());
          form.set("aiGenerated", "false");
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch(`/api/v1/admin/places/${place.id}/references`, { method: "POST", body: form, credentials: "same-origin" });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
              setMsg({ ok: false, text: body?.error?.message ?? "上传失败，请重试" });
              return;
            }
            setMsg({ ok: true, text: "已上传。审核发布后才会用于核验。" });
            formEl.reset();
            (formEl.elements.namedItem("photographer") as HTMLInputElement).value = photographer;
            onUploaded();
          } catch {
            setMsg({ ok: false, text: "网络连接失败，请检查网络后重试" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="survey-photo-file" className="block space-y-1 text-sm">
          <span className="font-semibold">照片</span>
          <input id="survey-photo-file" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="block w-full text-sm" />
        </label>
        <label htmlFor="survey-photo-view" className="block space-y-1 text-sm">
          <span className="font-semibold">取景说明</span>
          <input id="survey-photo-view" name="viewNote" required minLength={2} maxLength={300} className="w-full rounded-lg border border-rule px-3 py-2" placeholder="例如：西端，朝东平视，墙面和瓦顶" />
        </label>
        <label htmlFor="survey-photo-author" className="block space-y-1 text-sm">
          <span className="font-semibold">拍摄者</span>
          <input id="survey-photo-author" name="photographer" required maxLength={120} className="w-full rounded-lg border border-rule px-3 py-2" placeholder="署名用的名字" autoComplete="name" />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required className="mt-1" />
          <span>这张照片是我拍的，我同意东京支线项目把它用作地点核验的参考图。</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="publicDisplay" className="mt-1" />
          <span>也允许在地点页署名公开展示（画面里有可辨认的人时不要勾）。</span>
        </label>
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "上传中…" : "上传"}
        </button>
      </form>
      {msg && (
        <p role="status" className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function SurveyNote({ placeId, onSaved }: { placeId: string; onSaved: (v: SurveyView) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="card space-y-3 p-4" aria-labelledby="survey-note">
      <h3 id="survey-note" className="font-bold">
        现场记录
      </h3>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            onSaved(await apiPost<SurveyView>(`/admin/places/${placeId}/survey`, { kind: "note", note }));
            setNote("");
            setMsg({ ok: true, text: "已保存。" });
          } catch (err) {
            setMsg({ ok: false, text: errorText(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="survey-note-text" className="sr-only">
          现场记录
        </label>
        <textarea id="survey-note-text" rows={3} required maxLength={2000} className="w-full rounded-lg border border-rule px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="开放时间、拍照告示、施工情况、和资料不一致的地方……" />
        <button type="submit" className="btn btn-secondary w-full" disabled={busy || !note.trim()}>
          保存记录
        </button>
      </form>
      {msg && (
        <p role="status" className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function Entries({ placeId, view, onChange }: { placeId: string; view: SurveyView; onChange: (v: SurveyView) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (view.entries.length === 0) return <p className="text-sm text-muted">这个地点还没有踏勘记录。</p>;
  return (
    <section className="space-y-2" aria-labelledby="survey-entries">
      <h3 id="survey-entries" className="font-bold">
        已保存（{view.entries.length}）
      </h3>
      <ul className="space-y-2 text-sm">
        {view.entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 border-b border-rule pb-2">
            <div className="min-w-0" style={{ fontVariantNumeric: "tabular-nums" }}>
              {e.kind === "position" ? (
                <p>
                  <span className="font-semibold">{LABELS[e.label as Label] ?? e.label}</span> · 离打卡点 {e.distanceM} m · 精度 ±{Math.round(e.accuracyM ?? 0)} m · {e.readings} 次读数
                </p>
              ) : (
                <p className="whitespace-pre-wrap break-words">{e.note}</p>
              )}
              {e.kind === "position" && e.note && <p className="text-ink-2">{e.note}</p>}
              <p className="text-xs text-muted">{tokyoDateTime(e.createdAt)}</p>
            </div>
            {confirming === e.id ? (
              <span className="flex shrink-0 gap-2">
                <button type="button" className="underline" onClick={() => void apiDelete<SurveyView>(`/admin/places/${placeId}/survey/${e.id}`).then(onChange).finally(() => setConfirming(null))}>
                  确认删除
                </button>
                <button type="button" className="underline" onClick={() => setConfirming(null)}>
                  取消
                </button>
              </span>
            ) : (
              <button type="button" className="shrink-0 underline" onClick={() => setConfirming(e.id)}>
                删除
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
