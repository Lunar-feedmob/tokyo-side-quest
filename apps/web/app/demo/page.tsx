import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { capabilities } from "@tsq/core/config/env";
import { listPlaces } from "@tsq/core/services/places";
import { listQuests } from "@tsq/core/services/quests";
import { StartQuestButton } from "@/components/quest/start-quest-button";
import { DemoSamplePicker } from "@/components/checkin/demo-sample-picker";

export const metadata: Metadata = { title: "在线试玩" };

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">在线试玩 · Demo</p>
        <h1 className="serif text-3xl font-bold">不在东京，也能先走一遍</h1>
        <div className="notice notice-info space-y-1 text-sm">
          <p>
            <strong>这里是独立的试玩空间。</strong>定位使用模拟坐标，拍照使用固定的样例照片，核验和评分是预先标注好的样例结果，不是 AI 对你照片的真实判断。
          </p>
          <p>试玩记录不会出现在真实足迹里，也不会获得真实印章；试玩生成的票根会带“试玩纪念”标识。</p>
        </div>
      </header>
      <Suspense fallback={<p className="text-muted">加载中…</p>}>
        <DemoContent />
      </Suspense>
      <p className="text-center text-sm">
        <Link href="/me?mode=demo" className="underline">
          查看我的试玩记录
        </Link>
      </p>
    </div>
  );
}

async function DemoContent() {
  await connection();
  if (!capabilities().demo) return <p className="notice notice-warn">在线试玩当前未开启。</p>;
  const [quests, places] = await Promise.all([listQuests(), listPlaces({ visitorId: null, mode: "demo", limit: 100 })]);
  const photoPlace = places.items.find((p) => p.photoEnabled && p.status === "published");
  return (
    <>
      {quests[0] && (
        <section className="ticket space-y-3 p-5" aria-labelledby="demo-quest">
          <p className="eyebrow">试玩一 · 完整故事</p>
          <h2 id="demo-quest" className="serif text-xl font-bold">
            {quests[0].title}
          </h2>
          <p className="text-sm text-ink-2">用模拟定位或样例照片，依次完成 {quests[0].stepCount} 个任务，看到结局并获得试玩印章。</p>
          <StartQuestButton questId={quests[0].id} mode="demo" />
        </section>
      )}
      {photoPlace && (
        <section className="card space-y-3 p-5" aria-labelledby="demo-photo">
          <p className="eyebrow">试玩二 · 拍照打卡</p>
          <h2 id="demo-photo" className="serif text-xl font-bold">
            {photoPlace.nameZh} 的三种结果
          </h2>
          <p className="text-sm text-ink-2">选一张样例，体验“地点匹配 → 摄影评级”“无法确认”“地点不匹配”三种结果。</p>
          <DemoSamplePicker placeId={photoPlace.id} />
        </section>
      )}
    </>
  );
}
