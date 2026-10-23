import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "东京支线 · Tokyo Side Quest", template: "%s · 东京支线" },
  description: "不用做攻略，花一小时，成为一段东京故事的主角。发现附近地点、领取街区支线、拍照打卡并收藏城市印章。",
  applicationName: "东京支线",
};

export const viewport: Viewport = {
  themeColor: "#fafaf7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans">
      <body className="min-h-dvh antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
