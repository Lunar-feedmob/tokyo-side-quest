import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminApp } from "@/components/admin/admin-app";

export const metadata: Metadata = { title: "内容管理后台", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="text-muted">加载中…</p>}>
      <AdminApp />
    </Suspense>
  );
}
