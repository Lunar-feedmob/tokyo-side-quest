import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { listQuests } from "@tsq/core/services/quests";

export default function HomePage() {
  return (
    <div className="space-y-14">
      <section className="grid items-center gap-8 pt-4 md:grid-cols-[1.15fr_1fr] md:pt-10">
        <div className="space-y-5">
          <p className="eyebrow">Tokyo Side Quest · 城市任务票</p>
          <h1 className="serif text-4xl font-bold leading-tight md:text-5xl">
            今天在东京，
            <br />
            你想成为谁？
          </h1>
          <p className="max-w-md text-lg text-ink-2">
            不用做攻略，花一小时，成为一段东京故事的主角。领取一张任务票，开启你的城市支线。
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/explore?locate=1" className="btn btn-primary">
              发现我附近
            </Link>
            <Link href="/demo" className="btn btn-secondary">
              在线试玩
            </Link>
          </div>
          <p className="text-sm text-muted">点击“发现我附近”后才会请求定位；也可以不定位，直接选择街区浏览。</p>
        </div>
        <TicketPreview />
      </section>

      <section aria-labelledby="how" className="space-y-5">
        <h2 id="how" className="serif text-2xl font-bold">
          怎么玩
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          {[
            ["发现", "定位或选择街区，看看附近可以探索的地点。"],
            ["探索", "自由逛，或领取一段有线索和结局的街区故事。"],
            ["打卡", "定位打卡或拍照打卡，两种方式任选其一。"],
            ["收藏", "收集城市印章和作品，生成你的纪念票根。"],
          ].map(([title, text], i) => (
            <li key={title} className="card flex gap-3 p-4">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-line-green font-bold text-white">
                {i + 1}
              </span>
              <div>
                <p className="font-bold">{title}</p>
                <p className="text-sm text-ink-2">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="quest" className="space-y-4">
        <h2 id="quest" className="serif text-2xl font-bold">
          现在可以玩的故事
        </h2>
        <Suspense fallback={<div className="card h-40 animate-pulse" />}>
          <FeaturedQuests />
        </Suspense>
      </section>

      <section aria-labelledby="rules" className="card space-y-3 p-5">
        <h2 id="rules" className="serif text-xl font-bold">
          关于核验与评分
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>先核对照片是不是目标地点，地点匹配后才评价摄影表现；不匹配不会得到任何等级。</li>
          <li>定位打卡与拍照打卡相互独立。照片匹配只说明画面与地点相符，不代表你此刻在现场。</li>
          <li>摄影等级（SSS 至 D）由 AI 按固定标准给出建议，总分与等级由服务端计算。</li>
          <li>照片默认私有，只有你主动创建的分享链接才会公开。</li>
        </ul>
      </section>
    </div>
  );
}

async function FeaturedQuests() {
  await connection();
  const quests = await listQuests().catch(() => null);
  if (quests === null) {
    return <p className="notice notice-warn">故事列表暂时无法加载，请稍后刷新。</p>;
  }
  if (quests.length === 0) {
    return <p className="notice">暂时没有已发布的故事。可以先去发现附近地点自由探索。</p>;
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {quests.map((q) => (
        <li key={q.id}>
          <Link href={`/quests/${q.slug}`} className="ticket block p-5 no-underline hover:bg-paper-2">
            <p className="eyebrow">原创故事 · 约 {q.estimatedMinutes} 分钟 · {q.stepCount} 个任务</p>
            <p className="serif mt-1 text-xl font-bold">{q.title}</p>
            {q.subtitle && <p className="text-sm text-ink-2">{q.subtitle}</p>}
            <div className="perforation my-3" />
            <p className="line-clamp-3 text-sm text-ink-2">{q.intro}</p>
            <p className="mt-2 text-xs text-muted">{q.fictionNote}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TicketPreview() {
  return (
    <figure className="mx-auto w-full max-w-xs">
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered PNG from the real poster template */}
      <img
        src="/api/v1/posters/template-preview"
        alt="纪念票根模板示例：带有地点名、印章与日期的竖版票根"
        width={1080}
        height={1440}
        className="h-auto w-full rotate-[1.5deg] rounded-xl border border-rule shadow-[0_18px_40px_-20px_rgba(32,37,34,0.45)]"
      />
      <figcaption className="mt-3 text-center text-xs text-muted">由实际票根模板生成的示例，标有“样例”</figcaption>
    </figure>
  );
}
