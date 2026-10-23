import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppError } from "@tsq/core/http/errors";
import { getQuest } from "@tsq/core/services/quests";
import { StartQuestButton } from "@/components/quest/start-quest-button";

export default function QuestPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">加载故事…</p>}>
      <QuestContent params={params} />
    </Suspense>
  );
}

async function QuestContent({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  let quest;
  try {
    quest = await getQuest(decodeURIComponent(slug));
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <article className="mx-auto max-w-2xl space-y-6">
      <nav className="text-sm">
        <Link href="/quests" className="text-ink-2 underline">
          ← 全部故事
        </Link>
      </nav>
      <div className="ticket space-y-4 p-6">
        <p className="eyebrow">
          原创故事 · 约 {quest.estimatedMinutes} 分钟 · {quest.steps.filter((s) => s.required).length} 个主要任务
        </p>
        <h1 className="serif text-3xl font-bold leading-tight">{quest.title}</h1>
        {quest.subtitle && <p className="text-ink-2">{quest.subtitle}</p>}
        <div className="perforation" />
        <p className="leading-relaxed">{quest.intro}</p>
        <p className="text-xs text-muted">{quest.fictionNote}</p>
      </div>

      <section aria-labelledby="route" className="space-y-3">
        <h2 id="route" className="serif text-xl font-bold">
          途经地点
        </h2>
        <ol className="line-route space-y-3">
          {quest.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3">
              <span className="z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-line-green bg-paper text-sm font-bold text-line-green">
                {s.position}
              </span>
              <div className="pt-0.5">
                <Link href={`/places/${s.place.slug}`} className="font-semibold underline-offset-2 hover:underline">
                  {s.place.nameZh}
                </Link>
                <span className="ml-2 text-sm text-ink-2" lang="ja">
                  {s.place.nameJa}
                </span>
                <p className="text-xs text-muted">
                  {s.proofPolicy === "either" ? "定位或拍照完成" : s.proofPolicy === "location" ? "定位打卡完成" : "拍照打卡完成"}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted">线索和结局会在探索过程中逐步解锁。顺序只是建议，实际步行路线请以外部导航为准。</p>
      </section>

      <StartQuestButton questId={quest.id} />
    </article>
  );
}
