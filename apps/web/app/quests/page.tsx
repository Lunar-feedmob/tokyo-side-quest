import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listQuests } from "@tsq/core/services/quests";

export const metadata: Metadata = { title: "城市任务" };

export default function QuestsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">城市任务</p>
        <h1 className="serif text-3xl font-bold">领取一张任务票</h1>
        <p className="text-ink-2">每段故事都有开场、线索、任务与结局。不领取故事也可以直接自由探索地点。</p>
      </header>
      <Suspense fallback={<p className="text-muted">加载故事…</p>}>
        <QuestList />
      </Suspense>
    </div>
  );
}

async function QuestList() {
  await connection();
  const quests = await listQuests();
  if (quests.length === 0) return <p className="notice">暂时没有已发布的故事。</p>;
  return (
    <ul className="grid gap-5 md:grid-cols-2">
      {quests.map((q) => (
        <li key={q.id}>
          <Link href={`/quests/${q.slug}`} className="ticket block space-y-2 p-5 no-underline hover:bg-paper-2">
            <p className="eyebrow">
              原创故事 · 约 {q.estimatedMinutes} 分钟 · {q.stepCount} 个主要任务
            </p>
            <p className="serif text-2xl font-bold">{q.title}</p>
            {q.subtitle && <p className="text-sm text-ink-2">{q.subtitle}</p>}
            <div className="perforation" />
            <p className="line-clamp-3 text-sm text-ink-2">{q.intro}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
