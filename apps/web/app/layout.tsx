import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const description = "不用做攻略，花一小时，成为一段东京故事的主角。发现附近地点、领取街区支线、拍照打卡并收藏城市印章。";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: { default: "东京支线 · Tokyo Side Quest", template: "%s · 东京支线" },
  description,
  applicationName: "东京支线",
  openGraph: {
    title: "东京支线 · 今天在东京，你想成为谁？",
    description,
    images: [{ url: "/brand/og-1200x630.png", width: 1200, height: 630, alt: "东京支线：领取一张任务票，开启你的城市支线" }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/brand/og-1200x630.png"] },
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
