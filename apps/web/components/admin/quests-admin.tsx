"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, errorText } from "@/lib/client/api";

interface QuestRow {
  id: string;
  slug: string;
  status: string;
  publishedVersionId: string | null;
  versions: { id: string; version: number; title: string; publishedAt: string | null }[];
}

export function QuestsAdmin() {
  const [rows, setRows] = useState<QuestRow[] | null>(null);
  const [editing, setEditing] = useState<{ questId: string; json: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    apiGet<{ items: QuestRow[] }>("/admin/quests").then((r) => setRows(r.items));
  }, []);
  useEffect(load, [load]);

  async function startEdit(q: QuestRow) {
    const latest = q.versions[0];
    if (!latest) return;
    const v = await apiGet<{ version: Record<string, unknown>; steps: Record<string, unknown>[] }>(`/admin/quest-versions/${latest.id}`);
    const draft = {
      title: v.version.title,
      subtitle: v.version.subtitle,
      intro: v.version.intro,
      ending: v.version.ending,
      estimatedMinutes: v.version.estimatedMinutes,
      fictionNote: v.version.fictionNote,
      steps: v.steps.map((s) => ({
        placeSlug: s.placeSlug,
        proofPolicy: s.proofPolicy,
        required: s.required,
        title: s.title,
        story: s.story,
        objective: s.objective,
        clue: s.clue,
        observationQuestion: s.observationQuestion,
        completionText: s.completionText,
      })),
    };
    setEditing({ questId: q.id, json: JSON.stringify(draft, null, 2) });
  }

  async function saveVersion() {
    if (!editing) return;
    setMsg(null);
    try {
      const r = await apiPost<{ version: number }>(`/admin/quests/${editing.questId}/versions`, JSON.parse(editing.json));
      setMsg({ ok: true, text: `已创建草稿版本 v${r.version}。预览无误后点击发布。进行中的探索仍使用原版本，不会被改写。` });
      setEditing(null);
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof SyntaxError ? "JSON 格式不正确" : errorText(e) });
    }
  }
  async function publish(versionId: string) {
    setMsg(null);
    try {
      const r = await apiPost<{ version: number }>(`/admin/quest-versions/${versionId}/publish`);
      setMsg({ ok: true, text: `已发布 v${r.version}` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  }

  return (
    <div className="space-y-4">
      {msg && <p className={`notice text-sm ${msg.ok ? "notice-ok" : "notice-danger"}`}>{msg.text}</p>}
      {rows?.map((q) => (
        <section key={q.id} className="card space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">
              {q.versions[0]?.title ?? q.slug} <span className="text-xs text-muted">{q.slug}</span>
            </h2>
            <button type="button" className="btn btn-quiet" onClick={() => void startEdit(q)}>
              基于最新版本编辑
            </button>
          </div>
          <ul className="text-sm">
            {q.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                v{v.version} · {v.publishedAt ? `已发布 ${new Date(v.publishedAt).toLocaleDateString("zh-CN")}` : "草稿"}
                {v.id === q.publishedVersionId && <span className="chip chip-ok">当前</span>}
                {!v.publishedAt && (
                  <button type="button" className="underline" onClick={() => void publish(v.id)}>
                    发布
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editing?.questId === q.id && (
            <div className="space-y-2">
              <textarea value={editing.json} onChange={(e) => setEditing({ ...editing, json: e.target.value })} rows={20} className="w-full rounded border border-rule p-2 font-mono text-xs" aria-label="故事版本 JSON" />
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" onClick={() => void saveVersion()}>
                  保存为新草稿版本
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(null)}>
                  取消
                </button>
              </div>
              <p className="text-xs text-muted">发布时会检查主要节点的地点是否已发布、可用。</p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
