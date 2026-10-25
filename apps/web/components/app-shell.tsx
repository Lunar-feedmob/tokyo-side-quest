import Link from "next/link";
import { Suspense } from "react";
import { BottomNav, TopNav } from "./nav";
import { EnvBanner } from "./env-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 btn btn-quiet">
        跳到主要内容
      </a>
      <Suspense fallback={null}>
        <EnvBanner />
      </Suspense>
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 no-underline" aria-label="东京支线 首页">
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-vermilion font-serif text-sm font-bold text-white">
              支
            </span>
            <span className="serif text-lg font-bold tracking-wide">东京支线</span>
            <span className="hidden text-xs text-muted sm:inline">Tokyo Side Quest</span>
          </Link>
          <Suspense fallback={null}>
            <TopNav />
          </Suspense>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:pb-12">
        {children}
      </main>
      <footer className="hidden border-t border-rule py-6 text-center text-xs text-muted md:block">
        东京支线是独立项目，与东京官方机构、商家无合作或背书关系。原创故事为虚构内容；地点资料标注来源。
        <Link href="/settings/data" className="ml-2 underline">
          数据设置
        </Link>
      </footer>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
