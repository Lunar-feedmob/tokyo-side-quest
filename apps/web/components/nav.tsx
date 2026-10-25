"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/explore", label: "发现附近", icon: "◎", match: ["/explore", "/places"] },
  { href: "/quests", label: "城市任务", icon: "✦", match: ["/quests", "/adventures"] },
  { href: "/checkin", label: "拍照打卡", icon: "◉", match: ["/checkin", "/attempts"] },
  { href: "/me", label: "我的东京", icon: "❖", match: ["/me", "/posters", "/settings"] },
];

function useActive() {
  const pathname = usePathname() ?? "/";
  return (match: string[]) => match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

export function TopNav() {
  const isActive = useActive();
  return (
    <nav aria-label="主导航" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(item.match) ? "page" : undefined}
              className={`rounded-full px-3 py-2 text-sm font-semibold no-underline ${isActive(item.match) ? "bg-ink text-white" : "text-ink-2 hover:bg-paper-2"}`}
            >
              {item.label}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/demo" className="ml-2 rounded-full border border-ink px-3 py-1.5 text-sm font-semibold no-underline">
            在线试玩
          </Link>
        </li>
      </ul>
    </nav>
  );
}

export function BottomNav() {
  const isActive = useActive();
  return (
    <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActive(item.match);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold no-underline ${active ? "text-vermilion" : "text-ink-2"}`}
              >
                <span aria-hidden className="text-lg leading-none">
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
